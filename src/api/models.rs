use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl<T> ApiResponse<T> {
    pub fn success(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            message: None,
        }
    }
    pub fn error(message: impl Into<String>) -> Self {
        Self {
            success: false,
            data: None,
            message: Some(message.into()),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct CreateProviderReq {
    pub name: String,
    pub provider_type: String,
    pub base_url: String,
    pub api_key: String,
}

#[derive(Debug, Deserialize)]
pub struct CreatePoolReq {
    pub name: String,
    pub strategy: String,
    pub tool_trim_enabled: Option<bool>,
    pub tool_trim_dry_run: Option<bool>,
    pub max_tool_chars: Option<i32>,
    pub session_affinity_enabled: Option<bool>,
    pub session_affinity_ttl_secs: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct UpdatePoolReq {
    pub session_affinity_enabled: Option<bool>,
    pub session_affinity_ttl_secs: Option<i32>,
    pub tool_trim_enabled: Option<bool>,
    pub tool_trim_dry_run: Option<bool>,
    pub max_tool_chars: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct CreateEndpointReq {
    pub account_id: String,
    pub name: String,
    pub upstream_model_id: String,
    pub priority: Option<i32>,
    pub weight: Option<i32>,
    /// USD per 1M input tokens (optional; enables CostAware).
    pub input_price_per_1m: Option<f64>,
    /// USD per 1M output tokens (optional; enables CostAware).
    pub output_price_per_1m: Option<f64>,
    /// 0–1 capability prior for CapabilityAware.
    pub capability_score: Option<f64>,
    pub supports_tools: Option<bool>,
    pub context_length: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct CreateVirtualModelReq {
    pub pool_id: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateOrgReq {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateProjectReq {
    pub org_id: String,
    pub name: String,
    pub description: Option<String>,
    pub rpm_limit: Option<i32>,
    pub concurrency_limit: Option<i32>,
    pub daily_spend_limit: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct CreateApiKeyReq {
    pub project_id: String,
    pub name: String,
    pub rpm_limit: Option<i32>,
    pub concurrency_limit: Option<i32>,
    pub daily_spend_limit: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct ApiKeyResponse {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub key: String, // The actual plain text key, only returned on creation
    pub key_prefix: String,
}

#[derive(Debug, Deserialize)]
pub struct BindEndpointToPoolReq {
    pub pool_id: String,
    pub endpoint_id: String,
    pub priority: Option<i32>,
    pub weight: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct GrantModelToProjectReq {
    pub project_id: String,
    pub virtual_model_id: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProjectQuotaReq {
    pub rpm_limit: Option<i32>,
    pub concurrency_limit: Option<i32>,
    pub daily_spend_limit: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateApiKeyQuotaReq {
    pub rpm_limit: Option<i32>,
    pub concurrency_limit: Option<i32>,
    pub daily_spend_limit: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct PoolEndpointView {
    pub endpoint_id: String,
    pub name: String,
    pub upstream_model_id: String,
    pub enabled: bool,
    pub priority: i32,
    pub weight: i32,
    pub health_status: String,
    pub cooldown_until: Option<String>,
    pub account_name: String,
    pub provider_type: String,
    pub active_requests: i32,
    pub ema_latency_ms: f64,
}

#[derive(Debug, Serialize)]
pub struct EndpointView {
    pub id: String,
    pub account_id: String,
    pub account_name: String,
    pub name: String,
    pub upstream_model_id: String,
    pub enabled: bool,
    pub health_status: String,
    pub cooldown_until: Option<String>,
    pub priority: i32,
    pub weight: i32,
    pub input_price_per_1m: f64,
    pub output_price_per_1m: f64,
    pub capability_score: f64,
    pub supports_tools: Option<bool>,
    pub context_length: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct VirtualModelView {
    pub id: String,
    pub pool_id: String,
    pub pool_name: String,
    pub name: String,
    pub enabled: bool,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct ProjectGrantView {
    pub project_id: String,
    pub project_name: String,
    pub virtual_model_id: String,
    pub virtual_model_name: String,
}

#[derive(Debug, Deserialize)]
pub struct RevokeModelFromProjectReq {
    pub project_id: String,
    pub virtual_model_id: String,
}
