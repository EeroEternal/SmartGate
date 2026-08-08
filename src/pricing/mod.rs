//! In-memory endpoint pricing + capability profiles for scoring.

/// Normalized unit prices for one endpoint or upstream model.
#[derive(Debug, Clone, Copy, Default)]
pub struct UnitPrice {
    pub input_per_1m: f64,
    pub output_per_1m: f64,
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
