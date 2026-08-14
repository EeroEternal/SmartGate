//! Per-request routing hints for feedback scoring (best-effort under concurrency).

use std::sync::RwLock;

use once_cell::sync::Lazy;

#[derive(Debug, Clone, Default)]
pub struct RouteHint {
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub has_tools: bool,
    pub difficulty: f64,
    /// When true, prefer cheapest endpoints only (budget soft gate).
    pub downshift: bool,
    pub pool_id: String,
    /// Session affinity: boost this endpoint when healthy.
    pub affinity_enabled: bool,
    pub sticky_endpoint_id: Option<String>,
}

static CURRENT: Lazy<RwLock<Option<RouteHint>>> = Lazy::new(|| RwLock::new(None));

pub fn set_hint(hint: RouteHint) {
    if let Ok(mut g) = CURRENT.write() {
        *g = Some(hint);
    }
}

pub fn clear_hint() {
    if let Ok(mut g) = CURRENT.write() {
        *g = None;
    }
}

pub fn get_hint() -> Option<RouteHint> {
    CURRENT.read().ok().and_then(|g| g.clone())
}

/// RAII clear on drop.
pub struct HintGuard;

impl Drop for HintGuard {
    fn drop(&mut self) {
        clear_hint();
    }
}
