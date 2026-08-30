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
    /// Sticky multi-turn session: cost ranking should weight cache-read price.
    pub agentic: bool,
}

pub fn expected_cost(profile: &EndpointProfile, input: u32, output: u32, error_rate: f64) -> f64 {
    let err = error_rate.clamp(0.0, 0.95);
    if profile.price.is_priced() {
        profile.price.estimate_cost(input, output) * (1.0 + err)
    } else {
        f64::MAX / 8.0
    }
}

/// Fraction of input tokens assumed to be served from the provider prefix
/// cache for agentic (sticky multi-turn) sessions.
pub const AGENTIC_CACHE_FRACTION: f64 = 0.7;

/// Expected cost for an agentic session turn: most of the replayed prefix is
/// billed at the cache-read price, so endpoints with cheap cached input win on
/// multi-turn traffic even at an equal headline input price.
pub fn expected_agentic_cost(
    profile: &EndpointProfile,
    input: u32,
    output: u32,
    error_rate: f64,
) -> f64 {
    let err = error_rate.clamp(0.0, 0.95);
    if !profile.price.is_priced() {
        return f64::MAX / 8.0;
    }
    let cached = (input as f64 * AGENTIC_CACHE_FRACTION) as u32;
    let fresh = input.saturating_sub(cached);
    let cache_price = profile
        .price
        .cache_read_per_1m
        .unwrap_or_else(|| profile.price.input_per_1m * 0.1);
    ((fresh as f64 / 1_000_000.0) * profile.price.input_per_1m
        + (cached as f64 / 1_000_000.0) * cache_price
        + (output as f64 / 1_000_000.0) * profile.price.output_per_1m)
        * (1.0 + err)
}

/// Effective marginal cost factoring in economic billing tier (FreeTier, Subscription sunk-cost, PayAsYouGo),
/// rolling window watermark limits, and near-reset depletion urgency.
pub fn effective_marginal_cost(
    profile: &EndpointProfile,
    input: u32,
    output: u32,
    error_rate: f64,
    agentic: bool,
) -> f64 {
    use crate::pricing::BillingTier;

    let base_cost = if agentic {
        expected_agentic_cost(profile, input, output, error_rate)
    } else {
        expected_cost(profile, input, output, error_rate)
    };

    match profile.billing_tier {
        BillingTier::FreeTier => 0.000001 * (1.0 + error_rate.clamp(0.0, 0.95)),
        BillingTier::SubscriptionRolling => {
            let (utilization, urgency_mult) = if let Some(q) = profile.quota_status {
                let u = q.utilization.clamp(0.0, 1.0);
                let urgency = if u < 0.50 {
                    if let Some(rem) = q.reset_in_secs {
                        if rem <= 3600 {
                            (rem as f64 / 3600.0).clamp(0.2, 1.0)
                        } else {
                            1.0
                        }
                    } else {
                        1.0
                    }
                } else {
                    1.0
                };
                (u, urgency)
            } else {
                (0.0, 1.0)
            };

            // Soft conservation penalty if utilization reaches 80%
            let watermark_mult = if utilization >= 0.80 {
                let excess = (utilization - 0.80) / 0.15;
                1.0 + 10.0 * excess * excess
            } else {
                1.0
            };

            // Treat prepaid subscription as 99% cheaper sunk cost
            (base_cost * 0.01 * watermark_mult * urgency_mult).max(1e-9)
        }
        BillingTier::PayAsYouGo => base_cost,
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
    let base_cost = effective_marginal_cost(
        &input.profile,
        input.input_tokens,
        input.output_tokens,
        err,
        input.agentic,
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
            if !input.profile.price.is_priced() && input.profile.billing_tier != crate::pricing::BillingTier::FreeTier {
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
            let is_priced = input.profile.price.is_priced() || input.profile.billing_tier == crate::pricing::BillingTier::FreeTier;
            let normalized_cost = if is_priced {
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
                // Cost is the primary differentiator (cheaper = higher score).
                let cost_score = if is_priced {
                    (1.0 / (base_cost + 1e-12)).min(CAPABILITY_TIER_SCALE - 1_000_000.0)
                } else {
                    UNPRICED_SCORE
                };
                // Minor tie-breaker on capability if prices are identical
                let capability_tiebreaker = capability.clamp(0.0, 1.0) * 10.0;
                Some(tier * CAPABILITY_TIER_SCALE + cost_score + capability_tiebreaker)
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
                agentic: false,
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
                agentic: false,
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
                agentic: false,
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
                agentic: false,
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
                agentic: false,
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
                agentic: false,
            },
        )
        .unwrap();
        // Flash wins on simple task because both meet capability threshold but flash is much cheaper
        assert!(s_flash_simple > s_pro_simple);

        // 3. Ultra-short simple task (tokens < 50, where cost is microscopic)
        let s_flash_short = score(
            "capability_aware",
            ScoreInput {
                member: &m,
                profile: flash,
                active: 0,
                success_latency_ms: 0.0,
                all_latency_ms: 0.0,
                error_rate: 0.0,
                input_tokens: 20,
                output_tokens: 30,
                difficulty: 0.10,
                max_pool_capability: 0.95,
                agentic: false,
            },
        )
        .unwrap();
        let s_pro_short = score(
            "capability_aware",
            ScoreInput {
                member: &m,
                profile: pro,
                active: 0,
                success_latency_ms: 0.0,
                all_latency_ms: 0.0,
                error_rate: 0.0,
                input_tokens: 20,
                output_tokens: 30,
                difficulty: 0.10,
                max_pool_capability: 0.95,
                agentic: false,
            },
        )
        .unwrap();
        assert!(s_flash_short > s_pro_short);
    }
    #[test]
    fn cheap_cache_read_wins_for_agentic_sessions() {
        let m = member();
        // Identical headline prices; one declares a cheaper cached-input price.
        let cache_cheap = EndpointProfile {
            price: UnitPrice {
                input_per_1m: 1.0,
                output_per_1m: 2.0,
                cache_read_per_1m: Some(0.02),
            },
            ..Default::default()
        };
        let cache_default = EndpointProfile {
            price: UnitPrice {
                input_per_1m: 1.0,
                output_per_1m: 2.0,
                cache_read_per_1m: None,
            },
            ..Default::default()
        };
        let build = |profile: EndpointProfile, agentic: bool| {
            score(
                "cost_aware",
                ScoreInput {
                    member: &m,
                    profile,
                    active: 0,
                    success_latency_ms: 0.0,
                    all_latency_ms: 0.0,
                    error_rate: 0.0,
                    input_tokens: 30_000,
                    output_tokens: 2_000,
                    difficulty: 0.2,
                    max_pool_capability: 1.0,
                    agentic,
                },
            )
            .unwrap()
        };

        // Non-agentic requests do not see any difference.
        assert!(
            (build(cache_cheap, false) - build(cache_default, false)).abs() < 1e-9,
            "cache price must not affect single-shot ranking"
        );
        // Agentic sessions replay the prefix, so the explicit cheaper
        // cache-read price wins.
        assert!(build(cache_cheap, true) > build(cache_default, true));
    }

    #[test]
    fn free_tier_outranks_paid_models_in_cost_aware() {
        let m = member();
        let free_ep = EndpointProfile {
            billing_tier: crate::pricing::BillingTier::FreeTier,
            ..Default::default()
        };
        let paid_ep = EndpointProfile {
            price: UnitPrice {
                input_per_1m: 0.1,
                output_per_1m: 0.2,
                ..Default::default()
            },
            billing_tier: crate::pricing::BillingTier::PayAsYouGo,
            ..Default::default()
        };
        let s_free = score(
            "cost_aware",
            ScoreInput {
                member: &m,
                profile: free_ep,
                active: 0,
                success_latency_ms: 0.0,
                all_latency_ms: 0.0,
                error_rate: 0.0,
                input_tokens: 1000,
                output_tokens: 500,
                difficulty: 0.2,
                max_pool_capability: 1.0,
                agentic: false,
            },
        )
        .unwrap();
        let s_paid = score(
            "cost_aware",
            ScoreInput {
                member: &m,
                profile: paid_ep,
                active: 0,
                success_latency_ms: 0.0,
                all_latency_ms: 0.0,
                error_rate: 0.0,
                input_tokens: 1000,
                output_tokens: 500,
                difficulty: 0.2,
                max_pool_capability: 1.0,
                agentic: false,
            },
        )
        .unwrap();
        assert!(s_free > s_paid);
    }

    #[test]
    fn active_subscription_sunk_cost_outranks_pay_as_you_go() {
        let m = member();
        let sub_ep = EndpointProfile {
            price: UnitPrice {
                input_per_1m: 2.0,
                output_per_1m: 5.0,
                ..Default::default()
            },
            billing_tier: crate::pricing::BillingTier::SubscriptionRolling,
            quota_status: Some(crate::pricing::QuotaWindowStatus {
                utilization: 0.20,
                reset_in_secs: Some(7200),
            }),
            ..Default::default()
        };
        let payg_ep = EndpointProfile {
            price: UnitPrice {
                input_per_1m: 1.0,
                output_per_1m: 2.5,
                ..Default::default()
            },
            billing_tier: crate::pricing::BillingTier::PayAsYouGo,
            ..Default::default()
        };
        let s_sub = score(
            "cost_aware",
            ScoreInput {
                member: &m,
                profile: sub_ep,
                active: 0,
                success_latency_ms: 0.0,
                all_latency_ms: 0.0,
                error_rate: 0.0,
                input_tokens: 2000,
                output_tokens: 1000,
                difficulty: 0.2,
                max_pool_capability: 1.0,
                agentic: false,
            },
        )
        .unwrap();
        let s_payg = score(
            "cost_aware",
            ScoreInput {
                member: &m,
                profile: payg_ep,
                active: 0,
                success_latency_ms: 0.0,
                all_latency_ms: 0.0,
                error_rate: 0.0,
                input_tokens: 2000,
                output_tokens: 1000,
                difficulty: 0.2,
                max_pool_capability: 1.0,
                agentic: false,
            },
        )
        .unwrap();
        // Sunk-cost subscription has effectively 99% discount, beating cheaper PAYG token pricing
        assert!(s_sub > s_payg);
    }

    #[test]
    fn subscription_watermark_and_urgency_scoring() {
        let m = member();
        let base_profile = EndpointProfile {
            price: UnitPrice {
                input_per_1m: 2.0,
                output_per_1m: 5.0,
                ..Default::default()
            },
            billing_tier: crate::pricing::BillingTier::SubscriptionRolling,
            ..Default::default()
        };

        // 1. Normal usage
        let mut normal = base_profile;
        normal.quota_status = Some(crate::pricing::QuotaWindowStatus {
            utilization: 0.30,
            reset_in_secs: Some(10000),
        });

        // 2. High watermark (92% used)
        let mut high_watermark = base_profile;
        high_watermark.quota_status = Some(crate::pricing::QuotaWindowStatus {
            utilization: 0.92,
            reset_in_secs: Some(10000),
        });

        // 3. Urgent depletion (15 mins left before reset, 20% used)
        let mut urgent = base_profile;
        urgent.quota_status = Some(crate::pricing::QuotaWindowStatus {
            utilization: 0.20,
            reset_in_secs: Some(900),
        });

        let compute = |p: EndpointProfile| {
            score(
                "cost_aware",
                ScoreInput {
                    member: &m,
                    profile: p,
                    active: 0,
                    success_latency_ms: 0.0,
                    all_latency_ms: 0.0,
                    error_rate: 0.0,
                    input_tokens: 1000,
                    output_tokens: 500,
                    difficulty: 0.2,
                    max_pool_capability: 1.0,
                    agentic: false,
                },
            )
            .unwrap()
        };

        let s_normal = compute(normal);
        let s_high_wm = compute(high_watermark);
        let s_urgent = compute(urgent);

        // Urgent window gets highest score to burn unused quota before reset
        assert!(s_urgent > s_normal);
        // High watermark gets penalized to conserve remaining quota
        assert!(s_normal > s_high_wm);
    }
}
