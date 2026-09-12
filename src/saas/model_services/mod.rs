//! Model services: catalog, service and endpoint CRUD, connection tests, and probes.
//!
//! Handlers live in focused child modules: the market catalog, model service CRUD, endpoint
//! CRUD, and connection tests / health probes. The shared request and row types, the small
//! cross-module helpers, and the handler re-exports stay in this file.

mod catalog;
mod endpoints;
mod probe;
mod services;

pub(super) use catalog::list_model_catalog;
pub(super) use endpoints::{
    add_model_service_endpoint, delete_model_service_endpoint, update_model_service_endpoint,
};
pub(super) use probe::{
    probe_model_service_endpoint, test_connection, test_model_service_endpoint,
};
pub(super) use services::{
    create_model_service, delete_model_service, get_model_service, list_model_services,
    update_model_service,
};

use serde::Deserialize;

/// Model service detail row: (vm id, vm name, pool name, strategy, judge_enabled, judge_endpoint_id, pool id, shadow_enabled, shadow_virtual_model_id, shadow_sample_rate).
type ModelServiceDetailRow = (
    String,
    String,
    String,
    String,
    i32,
    Option<String>,
    String,
    i32,
    Option<String>,
    f64,
);

/// Flat model service list row: (vm id, vm name, pool name, strategy, provider type, upstream model, health status, endpoint name).
type ModelServiceListRow = (
    String,
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
);

/// Aggregated model service entry: (vm id, vm name, pool name, strategy, provider types, models, endpoint statuses).
type ModelServiceSummary = (
    String,
    String,
    String,
    String,
    Vec<String>,
    Vec<String>,
    Vec<String>,
);

#[derive(Debug, Deserialize, Clone)]
pub(super) struct ModelEndpointRequest {
    #[serde(default)]
    account_id: Option<String>,
    #[serde(default)]
    provider_type: Option<String>,
    #[serde(default)]
    provider_name: Option<String>,
    #[serde(default)]
    protocol: Option<String>,
    #[serde(default)]
    base_url: Option<String>,
    #[serde(default)]
    api_key: Option<String>,
    upstream_model_id: String,
    input_price_per_1m: Option<f64>,
    output_price_per_1m: Option<f64>,
    capability_score: Option<f64>,
    supports_tools: Option<bool>,
    context_length: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub(super) enum AddEndpointsPayload {
    Single(Box<ModelEndpointRequest>),
    Batch {
        endpoints: Vec<ModelEndpointRequest>,
    },
    List(Vec<ModelEndpointRequest>),
}

#[derive(Debug, Deserialize)]
pub(super) struct ModelServiceRequest {
    name: String,
    #[serde(default)]
    endpoints: Vec<ModelEndpointRequest>,
    // Keep the legacy fields readable for existing API clients. New clients should use endpoints.
    provider_type: Option<String>,
    base_url: Option<String>,
    api_key: Option<String>,
    upstream_model_id: Option<String>,
    strategy: Option<String>,
    input_price_per_1m: Option<f64>,
    output_price_per_1m: Option<f64>,
    capability_score: Option<f64>,
    supports_tools: Option<bool>,
    context_length: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub(super) struct UpdateModelServiceRequest {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    strategy: Option<String>,
    #[serde(default)]
    judge_enabled: Option<bool>,
    #[serde(default)]
    judge_endpoint_id: Option<String>,
    #[serde(default)]
    shadow_enabled: Option<bool>,
    #[serde(default)]
    shadow_virtual_model_id: Option<String>,
    #[serde(default)]
    shadow_sample_rate: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub(super) struct UpdateModelEndpointRequest {
    provider_name: String,
    provider_type: String,
    protocol: String,
    base_url: String,
    #[serde(default)]
    api_key: Option<String>,
    upstream_model_id: String,
    input_price_per_1m: Option<f64>,
    output_price_per_1m: Option<f64>,
    capability_score: Option<f64>,
    supports_tools: Option<bool>,
    context_length: Option<i32>,
}

/// Pool member of one model service, including the fields that explain routing.
#[derive(Debug, sqlx::FromRow)]
struct ServiceEndpointRow {
    id: String,
    provider_id: String,
    provider_name: String,
    provider_type: String,
    protocol: String,
    upstream_model_id: String,
    base_url: String,
    /// `None` = unpriced (unknown cost); `Some(0.0)` = free model.
    input_price_per_1m: Option<f64>,
    output_price_per_1m: Option<f64>,
    capability_score: f64,
    context_length: Option<i32>,
    enabled: bool,
    health_status: String,
    supports_tools: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct TestConnectionPayload {
    pub protocol: Option<String>,
    pub base_url: String,
    pub api_key: String,
    pub upstream_model_id: String,
}

fn clean_base_url(url: &str) -> String {
    url.trim().trim_end_matches('/').to_string()
}

#[cfg(test)]
mod tests {
    use super::clean_base_url;

    #[test]
    fn base_url_is_trimmed_and_stripped_of_trailing_slashes() {
        assert_eq!(
            clean_base_url("  https://api.example.com/v1/  "),
            "https://api.example.com/v1"
        );
        assert_eq!(
            clean_base_url("https://api.example.com/v1///"),
            "https://api.example.com/v1"
        );
    }

    #[test]
    fn base_url_without_trailing_slash_is_unchanged() {
        assert_eq!(
            clean_base_url("https://api.example.com"),
            "https://api.example.com"
        );
    }
}
