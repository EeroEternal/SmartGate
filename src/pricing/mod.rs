//! In-memory endpoint pricing + capability profiles for scoring.

/// Normalized unit prices for one endpoint or upstream model.
#[derive(Debug, Clone, Copy, Default)]
pub struct UnitPrice {
    pub input_per_1m: f64,
    pub output_per_1m: f64,
    pub cache_read_per_1m: Option<f64>,
}

impl UnitPrice {
    pub fn is_priced(&self) -> bool {
        self.input_per_1m > 0.0 || self.output_per_1m > 0.0
    }

    /// Rough expected cost for estimated token counts.
    pub fn estimate_cost(&self, input_tokens: u32, output_tokens: u32) -> f64 {
        (input_tokens as f64 / 1_000_000.0) * self.input_per_1m
            + (output_tokens as f64 / 1_000_000.0) * self.output_per_1m
    }

    /// Accurate cost calculation factoring in prompt cache hits.
    pub fn calculate_cost(
        &self,
        prompt_tokens: u32,
        completion_tokens: u32,
        cache_hit_tokens: Option<u32>,
    ) -> f64 {
        let hits = cache_hit_tokens.unwrap_or(0).min(prompt_tokens);
        let misses = prompt_tokens.saturating_sub(hits);
        let cache_price = self.cache_read_per_1m.unwrap_or_else(|| {
            if self.input_per_1m > 0.0 {
                // Default to 10% of base input price (90% discount) when cache hits occur
                self.input_per_1m * 0.1
            } else {
                0.0
            }
        });

        (misses as f64 / 1_000_000.0) * self.input_per_1m
            + (hits as f64 / 1_000_000.0) * cache_price
            + (completion_tokens as f64 / 1_000_000.0) * self.output_per_1m
    }
}

/// Endpoint profile used by CostAware / CapabilityAware feedback.
#[derive(Debug, Clone, Copy)]
pub struct EndpointProfile {
    pub price: UnitPrice,
    /// 0–1 capability prior (default 0.5 cold start).
    pub capability_score: f64,
    /// Capability implied by the upstream model name, used to break ties when two
    /// endpoints carry the same configured score.
    pub family_capability_score: f64,
    /// None = undeclared (do not hard-filter).
    pub supports_tools: Option<bool>,
    pub context_length: Option<i32>,
}

impl Default for EndpointProfile {
    fn default() -> Self {
        Self {
            price: UnitPrice::default(),
            capability_score: 0.5,
            family_capability_score: 0.5,
            supports_tools: None,
            context_length: None,
        }
    }
}

/// Heuristic default capability score (0.0 - 1.0) derived from upstream model name.
pub fn default_capability_score(model_id: &str, supports_reasoning: Option<bool>) -> f64 {
    let lower = model_id.to_ascii_lowercase();
    if lower.contains("r1")
        || lower.contains("reasoner")
        || lower.contains("o1")
        || lower.contains("o3")
        || lower.contains("claude-3-5-sonnet")
        || lower.contains("claude-3-7-sonnet")
        || lower.contains("opus")
        || lower.contains("gpt-4.5")
    {
        0.96
    } else if lower.contains("pro")
        || lower.contains("gpt-4o")
        || lower.contains("max")
        || lower.contains("70b")
        || lower.contains("72b")
        || lower.contains("405b")
        || lower.contains("deepseek-chat")
        || lower.contains("deepseek-v3")
        || lower.contains("deepseek-coder")
    {
        0.92
    } else if supports_reasoning == Some(true) {
        0.85
    } else if lower.contains("flash")
        || lower.contains("mini")
        || lower.contains("nano")
        || lower.contains("lite")
        || lower.contains("8b")
        || lower.contains("7b")
        || lower.contains("3b")
        || lower.contains("1.5b")
        || lower.contains("0.5b")
    {
        0.65
    } else {
        0.70
    }
}

/// Capability spread below this leaves CapabilityAware with nothing to rank on.
pub const CAPABILITY_SPREAD_MIN: f64 = 0.05;

/// Capability actually used for routing: cold-start placeholders fall back to the
/// model family profile, deliberate values are kept.
pub fn effective_capability_score(model_id: &str, configured: f64) -> f64 {
    if configured <= 0.0
        || (configured - 0.50).abs() < 1e-5
        || (configured - 0.70).abs() < 1e-5
    {
        default_capability_score(model_id, None)
    } else {
        configured.clamp(0.0, 1.0)
    }
}

/// Resolve the capability scores of one pool from `(upstream_model_id, configured)` pairs.
///
/// Configured values win, except when a multi-endpoint pool has no usable spread
/// while the model families clearly differ: ranking on price alone would then send
/// every hard request to the cheapest endpoint.
pub fn resolve_pool_capabilities(members: &[(String, f64)]) -> Vec<f64> {
    let configured: Vec<f64> = members.iter().map(|(_, value)| *value).collect();
    if members.len() < 2 {
        return configured;
    }
    let defaults: Vec<f64> = members
        .iter()
        .map(|(model, _)| default_capability_score(model, None))
        .collect();
    let spread = |values: &[f64]| {
        let max = values.iter().copied().fold(f64::MIN, f64::max);
        let min = values.iter().copied().fold(f64::MAX, f64::min);
        max - min
    };
    if spread(&configured) < CAPABILITY_SPREAD_MIN && spread(&defaults) >= CAPABILITY_SPREAD_MIN {
        defaults
    } else {
        configured
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flat_capability_profiles_fall_back_to_model_families() {
        let members = vec![
            ("deepseek-v4-flash".to_string(), 0.65),
            ("qwen3.6-flash".to_string(), 0.65),
            ("deepseek-v4-pro".to_string(), 0.65),
        ];
        let resolved = resolve_pool_capabilities(&members);
        assert_eq!(resolved[2], default_capability_score("deepseek-v4-pro", None));
        assert!(resolved[2] > resolved[0]);
    }

    #[test]
    fn deliberate_capability_profiles_are_preserved() {
        let members = vec![
            ("deepseek-v4-flash".to_string(), 0.60),
            ("deepseek-v4-pro".to_string(), 0.80),
        ];
        assert_eq!(resolve_pool_capabilities(&members), vec![0.60, 0.80]);
    }

    #[test]
    fn same_family_duplicates_keep_their_scores() {
        let members = vec![
            ("deepseek-v4-flash".to_string(), 0.66),
            ("deepseek-v4-flash".to_string(), 0.66),
        ];
        assert_eq!(resolve_pool_capabilities(&members), vec![0.66, 0.66]);
    }

    #[test]
    fn test_calculate_cost_with_cache_hit() {
        let price = UnitPrice {
            input_per_1m: 1.0,
            output_per_1m: 2.0,
            cache_read_per_1m: Some(0.02),
        };
        // 1M prompt tokens with 900k cache hit + 100k cache miss, 100k completion tokens
        // miss cost: 0.1M * 1.0 = 0.1
        // hit cost: 0.9M * 0.02 = 0.018
        // completion cost: 0.1M * 2.0 = 0.2
        // total: 0.318
        let cost = price.calculate_cost(1_000_000, 100_000, Some(900_000));
        assert!((cost - 0.318).abs() < 1e-6);
    }

    #[test]
    fn test_calculate_cost_default_discount() {
        let price = UnitPrice {
            input_per_1m: 1.0,
            output_per_1m: 2.0,
            cache_read_per_1m: None,
        };
        // default 10% discount on cache hits
        // miss cost: 0.5M * 1.0 = 0.5
        // hit cost: 0.5M * 0.1 = 0.05
        // completion cost: 0.1M * 2.0 = 0.2
        // total: 0.75
        let cost = price.calculate_cost(1_000_000, 100_000, Some(500_000));
        assert!((cost - 0.75).abs() < 1e-6);
    }

    #[test]
    fn test_default_capability_score() {
        assert!(default_capability_score("deepseek-v4-pro", None) > default_capability_score("deepseek-v4-flash", None));
        assert!(default_capability_score("deepseek-reasoner", None) >= 0.95);
        assert_eq!(default_capability_score("qwen3.6-flash", None), 0.65);
    }
}
