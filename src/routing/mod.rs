use crate::models::{EndpointMetric, ModelPool, PoolEndpointMember};
use chrono::Utc;
use dashmap::DashMap;
use std::sync::Arc;
use std::time::SystemTime;
use unigateway_sdk::core::feedback::{EndpointSignal, RoutingFeedback, RoutingFeedbackProvider};

/// Failure streak before an endpoint is marked unavailable and cooled down.
pub const FAILURE_THRESHOLD: i32 = 3;
/// Cooldown window after consecutive failures.
pub const COOLDOWN_SECS: i64 = 30;

pub struct ParaGatewayFeedbackProvider {
    pub metrics: Arc<DashMap<String, EndpointMetric>>,
    pub pools: Arc<DashMap<String, ModelPool>>,
    pub pool_members: Arc<DashMap<String, Vec<PoolEndpointMember>>>,
}

impl RoutingFeedbackProvider for ParaGatewayFeedbackProvider {
    fn feedback(&self, pool_id: &str) -> RoutingFeedback {
        let mut feedback = RoutingFeedback::default();

        let strategy = self
            .pools
            .get(pool_id)
            .map(|p| p.strategy.clone())
            .unwrap_or_else(|| "round_robin".to_string());

        let Some(members) = self.pool_members.get(pool_id) else {
            return feedback;
        };

        let now = Utc::now();

        for member in members.iter() {
            let metric = self.metrics.get(&member.endpoint_id);
            let (excluded, cooldown_until, recent_error_rate, active, success_latency, all_latency) =
                if let Some(m) = metric.as_ref() {
                    // Only suppress while cooldown is active so the endpoint can be probed again.
                    let excluded = m
                        .cooldown_until
                        .map(|until| until > now)
                        .unwrap_or(false);
                    let cooldown_until = m.cooldown_until.filter(|until| *until > now).map(|until| {
                        SystemTime::UNIX_EPOCH
                            + std::time::Duration::from_secs(until.timestamp().max(0) as u64)
                    });
                    let recent_error_rate = if m.total_requests > 0 {
                        Some(m.total_errors as f64 / m.total_requests as f64)
                    } else {
                        None
                    };
                    (
                        excluded,
                        cooldown_until,
                        recent_error_rate,
                        m.active_requests,
                        m.ema_success_latency_ms,
                        m.ema_latency_ms,
                    )
                } else {
                    (false, None, None, 0, 0.0, 0.0)
                };

            let score = match strategy.as_str() {
                "priority" => {
                    // Higher admin priority wins; weight breaks ties.
                    Some(member.priority as f64 * 1_000.0 + member.weight as f64)
                }
                "least_connections" => Some(1.0 / (1.0 + active as f64)),
                "latency_based" => {
                    let latency = if success_latency > 0.0 {
                        success_latency
                    } else if all_latency > 0.0 {
                        all_latency
                    } else {
                        0.0
                    };
                    if latency > 0.0 {
                        Some(1000.0 / latency)
                    } else {
                        // Unknown latency: treat as neutral so new endpoints can be probed.
                        Some(1.0)
                    }
                }
                // round_robin / random: scores unused for ordering, but still emit exclusion.
                _ => None,
            };

            feedback.endpoint_signals.insert(
                member.endpoint_id.clone(),
                EndpointSignal {
                    score,
                    excluded,
                    cooldown_until,
                    recent_error_rate,
                },
            );
        }

        feedback
    }
}
