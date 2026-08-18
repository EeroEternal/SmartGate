//! Pool strategy scoring (control plane). Execution order is UniGateway ScoreOrdered.

use crate::models::PoolEndpointMember;
use crate::pricing::EndpointProfile;

pub const COST_RANK_INPUT_TOKENS: u32 = 1_000;
pub const COST_RANK_OUTPUT_TOKENS: u32 = 512;
pub const UNPRICED_SCORE: f64 = 1e-12;

/// Canonical strategy names accepted on model pools.
pub fn canonicalize(name: &str) -> &str {
    match name {
        "latency" | "latency_based" | "stream_aware" => "load_aware",
        "lowest_price" | "balanced_cost" => "cost_aware",
        "smart" | "capability" => "capability_aware",
        "least_conn" => "least_connections",
        other => other,
    }
}

/// Whether this strategy uses feedback scores (ScoreOrdered on data plane).
pub fn uses_score_order(strategy: &str) -> bool {
    matches!(
        canonicalize(strategy),
        "priority"
            | "least_connections"
            | "load_aware"
            | "latency_based"
            | "cost_aware"
            | "capability_aware"
            | "score_ordered"
    )
}

#[derive(Debug, Clone, Copy)]
pub struct ScoreInput<'a> {
    pub member: &'a PoolEndpointMember,
    pub profile: EndpointProfile,
    pub active: i32,
    pub success_latency_ms: f64,
    pub all_latency_ms: f64,
    pub error_rate: f64,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub difficulty: f64,
    pub max_pool_capability: f64,
}

pub fn expected_cost(profile: &EndpointProfile, input: u32, output: u32, error_rate: f64) -> f64 {
    let err = error_rate.clamp(0.0, 0.95);
    if profile.price.is_priced() {
        profile.price.estimate_cost(input, output) * (1.0 + err)
    } else {
        f64::MAX / 8.0
    }
}

pub const CAPABILITY_TIER_SCALE: f64 = 1_000_000_000.0;
/// One 0.01 configured capability step outranks family profile and price.
pub const CAPABILITY_RANK_SCALE: f64 = 1_000_000.0;
/// Breaks ties between endpoints sharing a configured capability score.
pub const FAMILY_RANK_SCALE: f64 = 1_000.0;
/// Kept strictly below `FAMILY_RANK_SCALE` so price ranks last on hard tasks.
pub const COST_TERM_MAX: f64 = 999.0;
/// At or above this difficulty the pool must answer with its strongest endpoint.
pub const HARD_TASK_DIFFICULTY: f64 = 0.55;
/// Capability spread that still counts as "strongest in pool".
pub const CAPABILITY_TOP_TOLERANCE: f64 = 0.04;

/// Required capability score for a given difficulty D in [0, 1].
pub fn required_capability(difficulty: f64) -> f64 {
    0.35 + 0.55 * difficulty.clamp(0.0, 1.0)
}

/// Whether this endpoint is capability-qualified for the requested difficulty.
pub fn capability_qualified(
    capability_score: f64,
    difficulty: f64,
    max_pool_capability: f64,
) -> bool {
    if difficulty >= HARD_TASK_DIFFICULTY {
        capability_score >= (max_pool_capability - CAPABILITY_TOP_TOLERANCE)
    } else {
        capability_score >= required_capability(difficulty)
    }
}

/// Higher score = preferred.
pub fn score(strategy: &str, input: ScoreInput<'_>) -> Option<f64> {
    let strategy = canonicalize(strategy);
    let err = input.error_rate.clamp(0.0, 0.95);
    let base_cost = expected_cost(
        &input.profile,
        input.input_tokens,
        input.output_tokens,
        err,
    );

    match strategy {
        "priority" => {
            Some(input.member.priority as f64 * 1_000.0 + input.member.weight as f64)
        }
        "least_connections" => Some(1.0 / (1.0 + input.active as f64)),
        "load_aware" | "latency_based" => {
            let latency = if input.success_latency_ms > 0.0 {
                input.success_latency_ms
            } else if input.all_latency_ms > 0.0 {
                input.all_latency_ms
            } else {
                0.0
            };
            let lat_score = if latency > 0.0 {
                1000.0 / latency
            } else {
                1.0
            };
            let load_penalty = 1.0 / (1.0 + input.active as f64);
            Some(lat_score * load_penalty * (1.0 - 0.5 * err).max(0.1))
        }
        "cost_aware" => {
            if !input.profile.price.is_priced() {
                Some(UNPRICED_SCORE)
            } else {
                Some(1.0 / (base_cost + 1e-12))
            }
        }
        "capability_aware" => {
            let capability = input.profile.capability_score;
            let req = required_capability(input.difficulty);
            let capable =
                capability_qualified(capability, input.difficulty, input.max_pool_capability);
            let near_capable = capability >= (req - 0.10);
            let normalized_cost = if input.profile.price.is_priced() {
                (1.0 / (base_cost + 1e-6)).clamp(0.0, COST_TERM_MAX)
            } else {
                UNPRICED_SCORE
            };
            let tier = if capable {
                2.0
            } else if near_capable {
                1.0
            } else {
                0.0
            };
            if input.difficulty >= HARD_TASK_DIFFICULTY {
                // Hard tasks rank on configured capability, then on the model family
                // profile (so two endpoints sharing a score do not fall back to
                // price), and only then on cost.
                let capability_rank = (capability.clamp(0.0, 1.0) * 100.0).round();
                let family_rank = (input
                    .profile
                    .family_capability_score
                    .clamp(0.0, 1.0)
                    * 100.0)
                    .round();
                Some(
                    tier * CAPABILITY_TIER_SCALE
                        + capability_rank * CAPABILITY_RANK_SCALE
                        + family_rank * FAMILY_RANK_SCALE
                        + normalized_cost,
                )
            } else {
                // Easy tasks: any qualified endpoint answers well, so spend less.
                let capability_bonus = (capability - req) * 100.0;
                Some(tier * CAPABILITY_TIER_SCALE + normalized_cost + capability_bonus)
            }
        }
        // round_robin / random / fallback: data plane owns ordering
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pricing::{EndpointProfile, UnitPrice};

    fn member() -> PoolEndpointMember {
        PoolEndpointMember {
            endpoint_id: "e1".into(),
            priority: 2,
            weight: 5,
        }
    }

    #[test]
    fn cheaper_wins_cost_aware() {
        let m = member();
        let cheap = EndpointProfile {
            price: UnitPrice {
                input_per_1m: 1.0,
                output_per_1m: 2.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let expensive = EndpointProfile {
            price: UnitPrice {
                input_per_1m: 10.0,
                output_per_1m: 20.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let s_cheap = score(
            "cost_aware",
            ScoreInput {
                member: &m,
                profile: cheap,
                active: 0,
                success_latency_ms: 0.0,
                all_latency_ms: 0.0,
                error_rate: 0.0,
                input_tokens: 1000,
                output_tokens: 500,
                difficulty: 0.2,
                max_pool_capability: 1.0,
            },
        )
        .unwrap();
        let s_exp = score(
            "cost_aware",
            ScoreInput {
                member: &m,
                profile: expensive,
                active: 0,
                success_latency_ms: 0.0,
                all_latency_ms: 0.0,
                error_rate: 0.0,
                input_tokens: 1000,
                output_tokens: 500,
                difficulty: 0.2,
                max_pool_capability: 1.0,
            },
        )
        .unwrap();
        assert!(s_cheap > s_exp);
    }

    #[test]
    fn canonicalize_aliases() {
        assert_eq!(canonicalize("latency_based"), "load_aware");
        assert_eq!(canonicalize("lowest_price"), "cost_aware");
    }

    #[test]
    fn capability_aware_routes_pro_on_complex_and_flash_on_simple() {
        let m = member();
        let flash = EndpointProfile {
            price: UnitPrice {
                input_per_1m: 0.14,
                output_per_1m: 0.28,
                ..Default::default()
            },
            capability_score: 0.65,
            ..Default::default()
        };
        let pro = EndpointProfile {
            price: UnitPrice {
                input_per_1m: 2.5,
                output_per_1m: 10.0,
                ..Default::default()
            },
            capability_score: 0.95,
            ..Default::default()
        };

        // 1. Complex task (difficulty = 0.70)
        let diff_complex = 0.70;
        let s_flash_complex = score(
            "capability_aware",
            ScoreInput {
                member: &m,
                profile: flash,
                active: 0,
                success_latency_ms: 0.0,
                all_latency_ms: 0.0,
                error_rate: 0.0,
                input_tokens: 2000,
                output_tokens: 1000,
                difficulty: diff_complex,
                max_pool_capability: 0.95,
            },
        )
        .unwrap();
        let s_pro_complex = score(
            "capability_aware",
            ScoreInput {
                member: &m,
                profile: pro,
                active: 0,
                success_latency_ms: 0.0,
                all_latency_ms: 0.0,
                error_rate: 0.0,
                input_tokens: 2000,
                output_tokens: 1000,
                difficulty: diff_complex,
                max_pool_capability: 0.95,
            },
        )
        .unwrap();
        // Pro wins on complex task despite being ~30x more expensive
        assert!(s_pro_complex > s_flash_complex);

        // 2. Simple task (difficulty = 0.15)
        let diff_simple = 0.15;
        let s_flash_simple = score(
            "capability_aware",
            ScoreInput {
                member: &m,
                profile: flash,
                active: 0,
                success_latency_ms: 0.0,
                all_latency_ms: 0.0,
                error_rate: 0.0,
                input_tokens: 500,
                output_tokens: 200,
                difficulty: diff_simple,
                max_pool_capability: 0.95,
            },
        )
        .unwrap();
        let s_pro_simple = score(
            "capability_aware",
            ScoreInput {
                member: &m,
                profile: pro,
                active: 0,
                success_latency_ms: 0.0,
                all_latency_ms: 0.0,
                error_rate: 0.0,
                input_tokens: 500,
                output_tokens: 200,
                difficulty: diff_simple,
                max_pool_capability: 0.95,
            },
        )
        .unwrap();
        // Flash wins on simple task because both meet capability threshold but flash is much cheaper
        assert!(s_flash_simple > s_pro_simple);
    }
}
