use dashmap::DashMap;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const RPM_WINDOW: Duration = Duration::from_secs(60);
/// Entries whose window is empty and that have been idle longer than this are evicted.
const RPM_IDLE_TTL: Duration = Duration::from_secs(600);

#[derive(Debug)]
struct RpmState {
    events: VecDeque<Instant>,
    last_active: Instant,
}

impl RpmState {
    fn new(now: Instant) -> Self {
        Self {
            events: VecDeque::new(),
            last_active: now,
        }
    }
}

#[derive(Debug, Clone)]
pub struct QuotaLimits {
    pub rpm_limit: Option<u32>,
    pub concurrency_limit: Option<u32>,
}

#[derive(Debug, Clone)]
pub enum QuotaRejectReason {
    Rpm {
        scope: &'static str,
        limit: u32,
        retry_after_secs: u64,
    },
    Concurrency {
        scope: &'static str,
        limit: u32,
    },
}

impl QuotaRejectReason {
    pub fn message(&self) -> String {
        match self {
            Self::Rpm {
                scope,
                limit,
                retry_after_secs,
            } => format!(
                "Rate limit exceeded for {scope}: {limit} requests/minute. Retry after {retry_after_secs}s"
            ),
            Self::Concurrency { scope, limit } => {
                format!("Concurrency limit exceeded for {scope}: {limit} active requests")
            }
        }
    }

    pub fn retry_after_secs(&self) -> Option<u64> {
        match self {
            Self::Rpm {
                retry_after_secs, ..
            } => Some(*retry_after_secs),
            Self::Concurrency { .. } => Some(1),
        }
    }
}

/// In-memory hard limits for Project / API Key RPM and concurrency.
pub struct QuotaLimiter {
    key_rpm: DashMap<String, Mutex<RpmState>>,
    project_rpm: DashMap<String, Mutex<RpmState>>,
    key_concurrency: DashMap<String, AtomicU32>,
    project_concurrency: DashMap<String, AtomicU32>,
}

impl Default for QuotaLimiter {
    fn default() -> Self {
        Self::new()
    }
}

impl QuotaLimiter {
    pub fn new() -> Self {
        Self {
            key_rpm: DashMap::new(),
            project_rpm: DashMap::new(),
            key_concurrency: DashMap::new(),
            project_concurrency: DashMap::new(),
        }
    }

    /// Try to admit a request. On success, concurrency slots stay held until [`release`].
    pub fn try_acquire(
        &self,
        key_id: &str,
        project_id: &str,
        key_limits: &QuotaLimits,
        project_limits: &QuotaLimits,
    ) -> Result<(), QuotaRejectReason> {
        let now = Instant::now();

        // Check RPM first (no side effects on concurrency yet).
        if let Some(limit) = project_limits.rpm_limit {
            if let Some(retry) = self.would_exceed_rpm(&self.project_rpm, project_id, limit, now) {
                metrics::counter!("quota_rejected_total", "reason" => "rpm", "scope" => "project").increment(1);
                return Err(QuotaRejectReason::Rpm {
                    scope: "project",
                    limit,
                    retry_after_secs: retry,
                });
            }
        }
        if let Some(limit) = key_limits.rpm_limit {
            if let Some(retry) = self.would_exceed_rpm(&self.key_rpm, key_id, limit, now) {
                metrics::counter!("quota_rejected_total", "reason" => "rpm", "scope" => "api_key").increment(1);
                return Err(QuotaRejectReason::Rpm {
                    scope: "api_key",
                    limit,
                    retry_after_secs: retry,
                });
            }
        }

        // Concurrency: reserve project first, then key; roll back on failure.
        if let Some(limit) = project_limits.concurrency_limit {
            if !self.try_inc_concurrency(&self.project_concurrency, project_id, limit) {
                metrics::counter!("quota_rejected_total", "reason" => "concurrency", "scope" => "project").increment(1);
                return Err(QuotaRejectReason::Concurrency {
                    scope: "project",
                    limit,
                });
            }
        }
        if let Some(limit) = key_limits.concurrency_limit {
            if !self.try_inc_concurrency(&self.key_concurrency, key_id, limit) {
                if project_limits.concurrency_limit.is_some() {
                    self.dec_concurrency(&self.project_concurrency, project_id);
                }
                metrics::counter!("quota_rejected_total", "reason" => "concurrency", "scope" => "api_key").increment(1);
                return Err(QuotaRejectReason::Concurrency {
                    scope: "api_key",
                    limit,
                });
            }
        }

        // Commit RPM timestamps only after concurrency is reserved.
        if project_limits.rpm_limit.is_some() {
            self.record_rpm(&self.project_rpm, project_id, now);
        }
        if key_limits.rpm_limit.is_some() {
            self.record_rpm(&self.key_rpm, key_id, now);
        }

        Ok(())
    }

    pub fn release(&self, key_id: &str, project_id: Option<&str>) {
        self.dec_concurrency(&self.key_concurrency, key_id);
        if let Some(project_id) = project_id {
            self.dec_concurrency(&self.project_concurrency, project_id);
        }
    }

    fn would_exceed_rpm(
        &self,
        map: &DashMap<String, Mutex<RpmState>>,
        id: &str,
        limit: u32,
        now: Instant,
    ) -> Option<u64> {
        let mut evict = false;
        let retry = {
            let entry = map
                .entry(id.to_string())
                .or_insert_with(|| Mutex::new(RpmState::new(now)));
            let mut state = entry.lock().unwrap_or_else(|e| e.into_inner());
            prune_window(&mut state.events, now);
            if state.events.is_empty()
                && now.saturating_duration_since(state.last_active) >= RPM_IDLE_TTL
            {
                evict = true;
            }
            state.last_active = now;
            if state.events.len() as u32 >= limit {
                let retry = state
                    .events
                    .front()
                    .map(|oldest| {
                        RPM_WINDOW
                            .saturating_sub(now.saturating_duration_since(*oldest))
                            .as_secs()
                            .max(1)
                    })
                    .unwrap_or(1);
                Some(retry)
            } else {
                None
            }
        };
        if evict {
            Self::evict_if_empty(map, id, now);
        }
        retry
    }

    /// Remove the entry only if its window is still empty. `remove_if` holds
    /// the shard lock and re-checks the condition, so an entry updated
    /// concurrently between the read above and the removal is never dropped.
    fn evict_if_empty(map: &DashMap<String, Mutex<RpmState>>, id: &str, now: Instant) {
        map.remove_if(id, |_, state| {
            let mut state = state.lock().unwrap_or_else(|e| e.into_inner());
            prune_window(&mut state.events, now);
            state.events.is_empty()
        });
    }

    fn record_rpm(&self, map: &DashMap<String, Mutex<RpmState>>, id: &str, now: Instant) {
        let entry = map
            .entry(id.to_string())
            .or_insert_with(|| Mutex::new(RpmState::new(now)));
        let mut state = entry.lock().unwrap_or_else(|e| e.into_inner());
        prune_window(&mut state.events, now);
        state.last_active = now;
        state.events.push_back(now);
    }

    fn try_inc_concurrency(&self, map: &DashMap<String, AtomicU32>, id: &str, limit: u32) -> bool {
        let counter = map
            .entry(id.to_string())
            .or_insert_with(|| AtomicU32::new(0));
        loop {
            let cur = counter.load(Ordering::Relaxed);
            if cur >= limit {
                return false;
            }
            if counter
                .compare_exchange(cur, cur + 1, Ordering::SeqCst, Ordering::Relaxed)
                .is_ok()
            {
                return true;
            }
        }
    }

    fn dec_concurrency(&self, map: &DashMap<String, AtomicU32>, id: &str) {
        if let Some(counter) = map.get(id) {
            loop {
                let cur = counter.load(Ordering::Relaxed);
                if cur == 0 {
                    return;
                }
                if counter
                    .compare_exchange(cur, cur - 1, Ordering::SeqCst, Ordering::Relaxed)
                    .is_ok()
                {
                    return;
                }
            }
        }
    }
}

fn prune_window(q: &mut VecDeque<Instant>, now: Instant) {
    while q
        .front()
        .is_some_and(|t| now.duration_since(*t) >= RPM_WINDOW)
    {
        q.pop_front();
    }
}

/// RAII helper: releases concurrency if the request never reaches UniGateway finish hooks.
pub struct QuotaPermit {
    limiter: Arc<QuotaLimiter>,
    key_id: String,
    project_id: String,
    released: bool,
}

impl QuotaPermit {
    pub fn new(limiter: Arc<QuotaLimiter>, key_id: String, project_id: String) -> Self {
        Self {
            limiter,
            key_id,
            project_id,
            released: false,
        }
    }

    /// Hand ownership to hooks (`on_request_finished` will release).
    pub fn disarm(mut self) {
        self.released = true;
    }
}

impl Drop for QuotaPermit {
    fn drop(&mut self) {
        if !self.released {
            self.limiter
                .release(&self.key_id, Some(self.project_id.as_str()));
        }
    }
}
