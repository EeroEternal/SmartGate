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
    /// None = undeclared (do not hard-filter).
    pub supports_tools: Option<bool>,
    pub context_length: Option<i32>,
}

impl Default for EndpointProfile {
    fn default() -> Self {
        Self {
            price: UnitPrice::default(),
            capability_score: 0.5,
            supports_tools: None,
            context_length: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
