use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
pub struct Org {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
pub struct Project {
    pub id: String,
    pub org_id: String,
    pub name: String,
    pub description: Option<String>,
    pub rpm_limit: Option<i32>,
    pub concurrency_limit: Option<i32>,
    pub daily_spend_limit: Option<f64>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
pub struct ApiKey {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub key_hash: String,
    pub key_prefix: String,
    pub enabled: bool,
    pub metadata: Option<String>,
    pub rpm_limit: Option<i32>,
    pub concurrency_limit: Option<i32>,
    pub daily_spend_limit: Option<f64>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
pub struct ProviderAccount {
    pub id: String,
    pub name: String,
    pub provider_type: String,
    pub base_url: String,
    pub api_key: String,
    pub status: String,
    pub metadata: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
pub struct Endpoint {
    pub id: String,
    pub account_id: String,
    pub name: String,
    pub upstream_model_id: String,
    pub enabled: bool,
    pub priority: i32,
    pub weight: i32,
    pub health_status: String,
    pub cooldown_until: Option<DateTime<Utc>>,
    /// USD per 1M input tokens (0 = unpriced for CostAware).
    pub input_price_per_1m: f64,
    /// USD per 1M output tokens (0 = unpriced for CostAware).
    pub output_price_per_1m: f64,
    pub capability_score: f64,
    pub supports_tools: Option<i32>,
    pub context_length: Option<i32>,
    pub metadata: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
pub struct ModelPool {
    pub id: String,
    pub name: String,
    pub strategy: String,
    pub enabled: bool,
    pub tool_trim_enabled: i32,
    pub tool_trim_dry_run: i32,
    pub max_tool_chars: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
pub struct VirtualModel {
    pub id: String,
    pub pool_id: String,
    pub name: String,
    pub enabled: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
pub struct UsageLog {
    pub id: String,
    pub timestamp: DateTime<Utc>,
    pub org_id: Option<String>,
    pub project_id: Option<String>,
    pub key_id: Option<String>,
    pub virtual_model_id: Option<String>,
    pub pool_id: Option<String>,
    pub endpoint_id: Option<String>,
    pub provider_account_id: Option<String>,
    pub prompt_tokens: i32,
    pub completion_tokens: i32,
    pub total_tokens: i32,
    pub latency_ms: i32,
    pub status_code: Option<i32>,
    pub error_message: Option<String>,
    pub metadata: Option<String>,
}

/// Runtime metrics used for latency / least-connections scoring and health exclusion.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EndpointMetric {
    pub endpoint_id: String,
    pub active_requests: i32,
    pub ema_latency_ms: f64,
    pub ema_success_latency_ms: f64,
    pub total_requests: i32,
    pub total_errors: i32,
    pub consecutive_failures: i32,
    pub health_status: String,
    pub cooldown_until: Option<DateTime<Utc>>,
    pub last_error_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
}

impl EndpointMetric {
    pub fn new(endpoint_id: String) -> Self {
        Self {
            endpoint_id,
            active_requests: 0,
            ema_latency_ms: 0.0,
            ema_success_latency_ms: 0.0,
            total_requests: 0,
            total_errors: 0,
            consecutive_failures: 0,
            health_status: "healthy".to_string(),
            cooldown_until: None,
            last_error_at: None,
            updated_at: Utc::now(),
        }
    }
}

/// Pool membership used by routing feedback (priority/weight per pool).
#[derive(Debug, Clone)]
pub struct PoolEndpointMember {
    pub endpoint_id: String,
    pub priority: i32,
    pub weight: i32,
}
