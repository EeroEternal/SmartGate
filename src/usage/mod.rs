use crate::config::AppState;
use crate::models::EndpointMetric;
use crate::policy::record_success;
use crate::routing::{COOLDOWN_SECS, FAILURE_THRESHOLD};
use axum::{
    extract::{Json, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use chrono::{Duration, Utc};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;

impl EndpointMetric {
    /// Fold one attempt into the metric. Returns whether health changed and must be
    /// persisted; a success clears any state a previous process left behind.
    pub fn record_attempt(&mut self, success: bool, latency_ms: f64) -> bool {
        const ALPHA: f64 = 0.1;

        if self.active_requests > 0 {
            self.active_requests -= 1;
        }
        self.ema_latency_ms = if self.ema_latency_ms == 0.0 {
            latency_ms
        } else {
            (1.0 - ALPHA) * self.ema_latency_ms + ALPHA * latency_ms
        };
        self.updated_at = Utc::now();

        if success {
            self.ema_success_latency_ms = if self.ema_success_latency_ms == 0.0 {
                latency_ms
            } else {
                (1.0 - ALPHA) * self.ema_success_latency_ms + ALPHA * latency_ms
            };
            self.consecutive_failures = 0;
            if self.health_status != "healthy" {
                self.health_status = "healthy".to_string();
                self.cooldown_until = None;
                return true;
            }
            return false;
        }

        self.total_errors += 1;
        self.consecutive_failures += 1;
        self.last_error_at = Some(Utc::now());

        if self.consecutive_failures >= FAILURE_THRESHOLD {
            self.health_status = "unavailable".to_string();
            self.cooldown_until = Some(Utc::now() + Duration::seconds(COOLDOWN_SECS));
            true
        } else if self.health_status == "healthy" {
            self.health_status = "degraded".to_string();
            true
        } else {
            false
        }
    }
}

pub struct UsageRecordInput {
    pub endpoint_id: String,
    pub provider_account_id: Option<String>,
    pub latency_ms: u64,
    pub status_code: u16,
    pub error_message: Option<String>,
    pub provider_input_tokens: Option<u64>,
    pub provider_output_tokens: Option<u64>,
    pub provider_total_tokens: Option<u64>,
    pub cache_hit_tokens: Option<u64>,
    pub cache_write_tokens: Option<u64>,
    pub ttft_ms: Option<i32>,
    pub attempts: Vec<String>,
    pub metadata: HashMap<String, String>,
}

pub async fn record_attempt_metric(
    state: &AppState,
    endpoint_id: &str,
    success: bool,
    latency_ms: f64,
) {
    let (health_status, cooldown_until, health_changed) = {
        let mut metric = state
            .metrics
            .entry(endpoint_id.to_string())
            .or_insert_with(|| EndpointMetric::new(endpoint_id.to_string()));
        metric.total_requests += 1;
        let changed = metric.record_attempt(success, latency_ms);
        (metric.health_status.clone(), metric.cooldown_until, changed)
    };

    if health_changed {
        let _ = sqlx::query(
            "UPDATE endpoints SET health_status = $1, cooldown_until = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3",
        )
        .bind(&health_status)
        .bind(cooldown_until)
        .bind(endpoint_id)
        .execute(&state.db)
        .await;
    }
}

pub async fn record_request_usage(state: &AppState, input: UsageRecordInput) {
    let endpoint_id = input.endpoint_id;
    let estimated_input_tokens = input
        .metadata
        .get("input_tokens_est")
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    let estimated_output_tokens = input
        .metadata
        .get("output_tokens_est")
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);

    let has_provider_usage = input.provider_input_tokens.is_some()
        || input.provider_output_tokens.is_some()
        || input.provider_total_tokens.is_some();

    let usage_source = if has_provider_usage {
        "provider_reported"
    } else if estimated_input_tokens > 0 || estimated_output_tokens > 0 {
        "local_estimate"
    } else {
        "unavailable"
    };

    let usage_confidence = match (
        has_provider_usage,
        input.provider_input_tokens,
        input.provider_output_tokens,
    ) {
        (true, Some(_), Some(_)) => "high",
        (true, _, _) => "partial",
        (false, _, _) if usage_source == "local_estimate" => "low",
        _ => "unknown",
    };

    let prompt_tokens = input
        .provider_input_tokens
        .unwrap_or(estimated_input_tokens);
    let completion_tokens = input
        .provider_output_tokens
        .unwrap_or(estimated_output_tokens);
    let total_tokens = input
        .provider_total_tokens
        .unwrap_or(prompt_tokens + completion_tokens);

    if (200..300).contains(&input.status_code) {
        if let Some(mut metric) = state.metrics.get_mut(&endpoint_id) {
            metric.record_cache_observation(
                prompt_tokens as i64,
                input.cache_hit_tokens.unwrap_or(0) as i64,
            );
        }
    }

    let (unit_price, pricing_source) = state
        .profiles
        .get(&endpoint_id)
        .map(|profile| {
            let source = if profile.price.is_priced() {
                "configured_endpoint"
            } else {
                "unpriced"
            };
            (profile.price, source)
        })
        .unwrap_or((crate::pricing::UnitPrice::default(), "unpriced"));

    let estimated_cost = unit_price.calculate_cost(
        prompt_tokens as u32,
        completion_tokens as u32,
        input.cache_hit_tokens.map(|v| v as u32),
    );

    let routing_strategy = input.metadata.get("routing_strategy").cloned();
    let routing_decision = input.metadata.get("routing_decision").cloned();
    let tool_message_chars = input
        .metadata
        .get("tool_message_chars")
        .and_then(|s| s.parse::<i32>().ok())
        .unwrap_or(0);
    let trimmed_chars = input
        .metadata
        .get("trimmed_chars")
        .and_then(|s| s.parse::<i32>().ok())
        .unwrap_or(0);

    let session_id = input.metadata.get("session_id").cloned();
    let turn_index = input
        .metadata
        .get("turn_index")
        .and_then(|s| s.parse::<i32>().ok());
    let prefix_hash = input.metadata.get("prefix_hash").cloned();
    let context_epoch = input
        .metadata
        .get("context_epoch")
        .and_then(|s| s.parse::<i32>().ok())
        .unwrap_or(0);
    let affinity_enabled = input.metadata.get("affinity_enabled") == Some(&"1".to_string());
    let affinity_applied = input.metadata.get("affinity_applied") == Some(&"1".to_string());
    let sticky_endpoint_id = input.metadata.get("sticky_endpoint_id").cloned();
    let affinity_ttl_secs = input
        .metadata
        .get("affinity_ttl_secs")
        .and_then(|s| s.parse::<i32>().ok())
        .unwrap_or(3600);
    let affinity_hit = sticky_endpoint_id
        .as_ref()
        .map(|sticky| sticky == &endpoint_id)
        .unwrap_or(false);
    let prefix_hash_u64 = prefix_hash
        .as_ref()
        .and_then(|h| u64::from_str_radix(h, 16).ok());
    let cached_input_tokens = input.cache_hit_tokens.unwrap_or(0) as i32;

    let fallback_used = input.attempts.len() > 1;
    let mut metadata_values = input.metadata.clone();
    metadata_values.insert("usage_source".to_string(), usage_source.to_string());
    metadata_values.insert("usage_confidence".to_string(), usage_confidence.to_string());
    metadata_values.insert("pricing_source".to_string(), pricing_source.to_string());
    metadata_values.insert("attempts".to_string(), input.attempts.join(","));
    metadata_values.insert(
        "attempt_count".to_string(),
        input.attempts.len().to_string(),
    );
    metadata_values.insert(
        "fallback".to_string(),
        if fallback_used { "true" } else { "false" }.to_string(),
    );

    let metadata_json = serde_json::to_string(&metadata_values).unwrap_or_default();

    if (200..300).contains(&input.status_code) {
        if let (Some(sid), Some(pool_id)) = (
            session_id.as_deref(),
            input.metadata.get("pool_id").map(|s| s.as_str()),
        ) {
            if affinity_enabled {
                record_success(
                    pool_id,
                    sid,
                    context_epoch as u32,
                    &endpoint_id,
                    prefix_hash_u64,
                    affinity_hit,
                    affinity_ttl_secs,
                );
            }
        }
    }

    if let Some(key_id) = input.metadata.get("key_id") {
        let _ = sqlx::query("UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = $1")
            .bind(key_id)
            .execute(&state.db)
            .await;
    }

    let res = sqlx::query(
        "INSERT INTO usage_logs (
            id, org_id, project_id, key_id, virtual_model_id,
            pool_id, endpoint_id, provider_account_id,
            prompt_tokens, completion_tokens, total_tokens, cache_hit_tokens, cache_write_tokens,
            latency_ms, status_code, error_message, metadata,
            estimated_cost, routing_strategy, routing_decision,
            tool_message_chars, trimmed_chars,
            usage_source, usage_confidence, pricing_source,
            input_price_snapshot, output_price_snapshot, pricing_version,
            session_id, turn_index, ttft_ms, cached_input_tokens,
            affinity_applied, affinity_hit, prefix_hash, context_epoch
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36)",
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(input.metadata.get("org_id"))
    .bind(input.metadata.get("project_id"))
    .bind(input.metadata.get("key_id"))
    .bind(input.metadata.get("virtual_model_id"))
    .bind(input.metadata.get("pool_id"))
    .bind(&endpoint_id)
    .bind(input.provider_account_id)
    .bind(prompt_tokens as i32)
    .bind(completion_tokens as i32)
    .bind(total_tokens as i32)
    .bind(input.cache_hit_tokens.map(|v| v as i64))
    .bind(input.cache_write_tokens.map(|v| v as i64))
    .bind(input.latency_ms as i32)
    .bind(input.status_code as i32)
    .bind(input.error_message)
    .bind(metadata_json)
    .bind(estimated_cost)
    .bind(routing_strategy)
    .bind(routing_decision)
    .bind(tool_message_chars)
    .bind(trimmed_chars)
    .bind(usage_source)
    .bind(usage_confidence)
    .bind(pricing_source)
    .bind(unit_price.input_price())
    .bind(unit_price.output_price())
    .bind(if pricing_source == "configured_endpoint" {
        Some("sqlite-v1")
    } else {
        None
    })
    .bind(session_id)
    .bind(turn_index)
    .bind(input.ttft_ms)
    .bind(cached_input_tokens)
    .bind(if affinity_applied { 1 } else { 0 })
    .bind(if affinity_hit { 1 } else { 0 })
    .bind(prefix_hash)
    .bind(context_epoch)
    .execute(&state.db)
    .await;

    if let Err(e) = res {
        tracing::error!("Failed to log usage: {}", e);
    }
}

#[derive(Debug, Deserialize)]
pub struct XliteUsageWebhookPayload {
    /// Name of the `xlite` key the caller used (xlite reports `api_key_name`).
    #[serde(alias = "api_key_name")]
    pub api_key: Option<String>,
    pub model: Option<String>,
    #[serde(alias = "provider_name")]
    pub provider: Option<String>,
    #[serde(alias = "input_tokens")]
    pub prompt_tokens: Option<i32>,
    #[serde(alias = "output_tokens")]
    pub completion_tokens: Option<i32>,
    #[serde(alias = "tokens")]
    pub total_tokens: Option<i32>,
    #[serde(alias = "latency")]
    pub latency_ms: Option<i32>,
}

/// Optional webhook endpoint (`POST /api/gateway/usage`) for standalone `xlite` containers
/// when clients connect to `xlite` directly.
pub async fn xlite_usage_webhook(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<XliteUsageWebhookPayload>,
) -> impl IntoResponse {
    let auth_ok = headers
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(|token| {
            token == state.config.xlite_admin_password || token == state.config.admin_token
        })
        .unwrap_or(false);

    if !auth_ok {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "Unauthorized"})),
        );
    }

    let prompt = payload.prompt_tokens.unwrap_or(0);
    let completion = payload.completion_tokens.unwrap_or(0);
    let total = payload.total_tokens.unwrap_or(prompt + completion);
    let latency = payload.latency_ms.unwrap_or(0);

    // If the call used SmartGate's internal xlite key, SmartGate's own proxy handler
    // already logs full usage with routing_decision attribution, so avoid double-counting.
    // xlite reports the key name (`smartgate-control-plane` from the pushed catalog).
    let internal_key_name = "smartgate-control-plane";
    if payload.api_key.as_deref() == Some(state.config.xlite_internal_key.as_str())
        || payload.api_key.as_deref() == Some(internal_key_name)
    {
        return (
            StatusCode::OK,
            Json(serde_json::json!({"ok": true, "skipped": "internal"})),
        );
    }

    let _ = sqlx::query(
        "INSERT INTO usage_logs (
            id, prompt_tokens, completion_tokens, total_tokens, latency_ms, status_code,
            usage_source, usage_confidence, pricing_source, metadata
        ) VALUES ($1, $2, $3, $4, $5, 200, 'xlite_webhook', 'high', 'unpriced', $6)",
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(prompt)
    .bind(completion)
    .bind(total)
    .bind(latency)
    .bind(
        serde_json::json!({
            "model": payload.model,
            "provider": payload.provider,
        })
        .to_string(),
    )
    .execute(&state.db)
    .await;

    (StatusCode::OK, Json(serde_json::json!({"ok": true})))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_success_clears_health_recorded_by_a_previous_process() {
        let mut metric = EndpointMetric::new("ep".to_string());
        metric.health_status = "degraded".to_string();

        assert!(metric.record_attempt(true, 120.0));
        assert_eq!(metric.health_status, "healthy");
        assert!(metric.cooldown_until.is_none());
    }

    #[test]
    fn repeated_failures_cool_the_endpoint_down() {
        let mut metric = EndpointMetric::new("ep".to_string());

        assert!(metric.record_attempt(false, 50.0));
        assert_eq!(metric.health_status, "degraded");
        metric.record_attempt(false, 50.0);
        assert!(metric.record_attempt(false, 50.0));
        assert_eq!(metric.health_status, "unavailable");
        assert!(metric.cooldown_until.is_some());
    }
}
