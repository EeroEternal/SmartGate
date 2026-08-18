//! SmartGate control-plane routing feedback for UniGateway data plane.
//!
//! Strategies implement Cost / Control / Choice (see `docs/scope.md`):
//! - Cost: `cost_aware`, `capability_aware`
//! - Control: health exclusion, budget downshift, tools hard-filter
//! - Choice: multi-endpoint pools ordered by score

mod strategy;

pub use strategy::{
    canonicalize as canonicalize_strategy, capability_qualified, uses_score_order,
    CAPABILITY_TIER_SCALE, COST_RANK_INPUT_TOKENS, COST_RANK_OUTPUT_TOKENS, HARD_TASK_DIFFICULTY,
};

use crate::models::{EndpointMetric, ModelPool, PoolEndpointMember};
use crate::policy::{get_hint, get_task_hint};
use crate::pricing::EndpointProfile;
use chrono::Utc;
use dashmap::DashMap;
use std::sync::Arc;
use std::time::SystemTime;
use strategy::{expected_cost, score as score_endpoint, ScoreInput};
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
    pub hints: Arc<DashMap<String, crate::policy::RouteHint>>,
}

/// Score boost so sticky endpoint wins within its tier when healthy.
pub const AFFINITY_BOOST: f64 = 10_000.0;

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
        // The task-local hint belongs to the request being dispatched. The shared
        // maps are only a fallback: they are written by every concurrent request,
        // so reading them first lets an easy request decide a hard request's route.
        let hint = get_task_hint()
            .or_else(|| self.hints.get(pool_id).map(|h| h.clone()))
            .or_else(get_hint);
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

        let max_pool_capability = if strategy == "capability_aware" {
            members
                .iter()
                .map(|m| {
                    self.profiles
                        .get(&m.endpoint_id)
                        .map(|p| p.capability_score)
                        .unwrap_or(0.5)
                })
                .fold(0.0_f64, f64::max)
        } else {
            1.0
        };

        // A hard task must keep its capability-qualified endpoints even when the
        // budget soft gate wants cheaper ones, otherwise the pool silently
        // downgrades complex requests to a weaker model.
        let budget_protected: std::collections::HashSet<String> =
            if strategy == "capability_aware" && difficulty >= HARD_TASK_DIFFICULTY {
                members
                    .iter()
                    .filter(|m| {
                        let capability = self
                            .profiles
                            .get(&m.endpoint_id)
                            .map(|p| p.capability_score)
                            .unwrap_or(0.5);
                        capability_qualified(capability, difficulty, max_pool_capability)
                    })
                    .map(|m| m.endpoint_id.clone())
                    .collect()
            } else {
                std::collections::HashSet::new()
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

        let mut trace: Vec<CandidateTrace> = Vec::with_capacity(members.len());

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
            let mut exclusion_reason = if excluded_health { "health" } else { "" };
            // Control: tools required but endpoint declares no support.
            if has_tools && profile.supports_tools == Some(false) {
                excluded = true;
                exclusion_reason = "tools_unsupported";
            }
            // Control: budget soft gate → drop clearly expensive endpoints.
            if downshift
                && profile.price.is_priced()
                && base_cost > median_cost * 1.05
                && !budget_protected.contains(&member.endpoint_id)
            {
                excluded = true;
                exclusion_reason = "budget_downshift";
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
                    max_pool_capability,
                },
            );

            if affinity_enabled && endpoint_score.is_none() {
                endpoint_score = Some(1.0);
            }

            trace.push(CandidateTrace {
                endpoint_id: member.endpoint_id.clone(),
                capability: profile.capability_score,
                expected_cost: base_cost,
                score: endpoint_score,
                excluded,
                exclusion_reason: exclusion_reason.to_string(),
            });

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
                let sticky_is_capable = if strategy == "capability_aware" {
                    let sticky_cap = self
                        .profiles
                        .get(&sticky)
                        .map(|p| p.capability_score)
                        .unwrap_or(0.0);
                    capability_qualified(sticky_cap, difficulty, max_pool_capability)
                } else {
                    true
                };

                if sticky_is_capable {
                    if let Some(signal) = feedback.endpoint_signals.get_mut(&sticky) {
                        if !signal.excluded {
                            signal.score = Some(
                                signal.score.unwrap_or(0.0) + AFFINITY_BOOST,
                            );
                        }
                    }
                }
            }
        }

        trace.sort_by(|left, right| {
            left.excluded
                .cmp(&right.excluded)
                .then_with(|| {
                    right
                        .score
                        .unwrap_or(f64::NEG_INFINITY)
                        .total_cmp(&left.score.unwrap_or(f64::NEG_INFINITY))
                })
                .then_with(|| left.endpoint_id.cmp(&right.endpoint_id))
        });

        tracing::info!(
            target: "smartgate.routing",
            pool_id,
            strategy = %strategy,
            difficulty,
            required_capability = strategy::required_capability(difficulty),
            max_cap = max_pool_capability,
            downshift,
            has_tools,
            candidates = ?trace,
            "routing feedback generated"
        );

        feedback
    }
}

/// Per-candidate routing explanation, ordered the way the data plane will try them.
#[derive(Debug)]
struct CandidateTrace {
    endpoint_id: String,
    capability: f64,
    expected_cost: f64,
    score: Option<f64>,
    excluded: bool,
    exclusion_reason: String,
}
