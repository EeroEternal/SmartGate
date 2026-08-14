//! SmartGate control-plane routing feedback for UniGateway data plane.
//!
//! Strategies implement Cost / Control / Choice (see `docs/scope.md`):
//! - Cost: `cost_aware`, `capability_aware`
//! - Control: health exclusion, budget downshift, tools hard-filter
//! - Choice: multi-endpoint pools ordered by score

mod strategy;

pub use strategy::{
    canonicalize as canonicalize_strategy, uses_score_order, CAPABILITY_MARGIN,
    CAPABILITY_THRESHOLD, COST_RANK_INPUT_TOKENS, COST_RANK_OUTPUT_TOKENS,
};

use crate::models::{EndpointMetric, ModelPool, PoolEndpointMember};
use crate::policy::get_hint;
use crate::pricing::EndpointProfile;
use chrono::Utc;
use dashmap::DashMap;
use std::sync::Arc;
use std::time::SystemTime;
use strategy::{capability_mu, expected_cost, score as score_endpoint, ScoreInput};
use unigateway_sdk::core::feedback::{EndpointSignal, RoutingFeedback, RoutingFeedbackProvider};

/// Failure streak before an endpoint is marked unavailable and cooled down.
pub const FAILURE_THRESHOLD: i32 = 3;
/// Cooldown window after consecutive failures.
pub const COOLDOWN_SECS: i64 = 30;

/// Control-plane routing scores consumed by the UniGateway data plane.
pub struct SmartGateFeedbackProvider {
    pub metrics: Arc<DashMap<String, EndpointMetric>>,
    pub pools: Arc<DashMap<String, ModelPool>>,
    pub pool_members: Arc<DashMap<String, Vec<PoolEndpointMember>>>,
    pub profiles: Arc<DashMap<String, EndpointProfile>>,
}

/// Score boost so sticky endpoint wins ScoreOrdered when healthy.
pub const AFFINITY_BOOST: f64 = 1_000_000.0;

impl RoutingFeedbackProvider for SmartGateFeedbackProvider {
    fn feedback(&self, pool_id: &str) -> RoutingFeedback {
        let mut feedback = RoutingFeedback::default();

        let raw_strategy = self
            .pools
            .get(pool_id)
            .map(|p| p.strategy.clone())
            .unwrap_or_else(|| "round_robin".to_string());
        let strategy = canonicalize_strategy(&raw_strategy).to_string();

        let Some(members) = self.pool_members.get(pool_id) else {
            return feedback;
        };

        let now = Utc::now();
        let hint = get_hint().filter(|h| h.pool_id.is_empty() || h.pool_id == pool_id);
        let input_tok = hint
            .as_ref()
            .map(|h| h.input_tokens)
            .unwrap_or(COST_RANK_INPUT_TOKENS);
        let output_tok = hint
            .as_ref()
            .map(|h| h.output_tokens)
            .unwrap_or(COST_RANK_OUTPUT_TOKENS);
        let difficulty = hint.as_ref().map(|h| h.difficulty).unwrap_or(0.2);
        let has_tools = hint.as_ref().map(|h| h.has_tools).unwrap_or(false);
        let downshift = hint.as_ref().map(|h| h.downshift).unwrap_or(false);
        let affinity_enabled = hint.as_ref().map(|h| h.affinity_enabled).unwrap_or(false);
        let sticky_endpoint_id = hint
            .as_ref()
            .and_then(|h| h.sticky_endpoint_id.clone());

        let top_mu = if strategy == "capability_aware" {
            members
                .iter()
                .map(|m| {
                    let p = self
                        .profiles
                        .get(&m.endpoint_id)
                        .map(|x| *x)
                        .unwrap_or_default();
                    capability_mu(&p, difficulty)
                })
                .fold(0.0_f64, f64::max)
        } else {
            0.0
        };

        let median_cost = {
            let mut costs: Vec<f64> = members
                .iter()
                .filter_map(|m| {
                    let p = self.profiles.get(&m.endpoint_id)?;
                    if p.price.is_priced() {
                        Some(expected_cost(&p, input_tok, output_tok, 0.0))
                    } else {
                        None
                    }
                })
                .collect();
            if costs.is_empty() {
                f64::MAX
            } else {
                costs.sort_by(f64::total_cmp);
                costs[costs.len() / 2]
            }
        };

        for member in members.iter() {
            let metric = self.metrics.get(&member.endpoint_id);
            let (excluded_health, cooldown_until, recent_error_rate, active, success_latency, all_latency) =
                if let Some(m) = metric.as_ref() {
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

            let profile = self
                .profiles
                .get(&member.endpoint_id)
                .map(|p| *p)
                .unwrap_or_default();

            let err = recent_error_rate.unwrap_or(0.0);
            let base_cost = expected_cost(&profile, input_tok, output_tok, err);

            let mut excluded = excluded_health;
            // Control: tools required but endpoint declares no support.
            if has_tools && profile.supports_tools == Some(false) {
                excluded = true;
            }
            // Control: budget soft gate → drop clearly expensive endpoints.
            if downshift && profile.price.is_priced() && base_cost > median_cost * 1.05 {
                excluded = true;
            }

            let mut endpoint_score = score_endpoint(
                &strategy,
                ScoreInput {
                    member,
                    profile,
                    active,
                    success_latency_ms: success_latency,
                    all_latency_ms: all_latency,
                    error_rate: err,
                    input_tokens: input_tok,
                    output_tokens: output_tok,
                    difficulty,
                    top_mu,
                },
            );

            if affinity_enabled && endpoint_score.is_none() {
                endpoint_score = Some(1.0);
            }

            feedback.endpoint_signals.insert(
                member.endpoint_id.clone(),
                EndpointSignal {
                    score: endpoint_score,
                    excluded,
                    cooldown_until,
                    recent_error_rate,
                },
            );
        }

        if affinity_enabled {
            if let Some(sticky) = sticky_endpoint_id {
                if let Some(signal) = feedback.endpoint_signals.get_mut(&sticky) {
                    if !signal.excluded {
                        signal.score = Some(
                            signal.score.unwrap_or(0.0) + AFFINITY_BOOST,
                        );
                    }
                }
            }
        }

        feedback
    }
}
