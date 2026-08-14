use crate::models::EndpointMetric;
use crate::policy::record_success;
use crate::pricing::EndpointProfile;
use crate::quota::QuotaLimiter;
use crate::routing::{COOLDOWN_SECS, FAILURE_THRESHOLD};
use chrono::{Duration, Utc};
use dashmap::DashMap;
use futures_util::future::BoxFuture;
use sqlx::PgPool;
use std::sync::Arc;
use unigateway_sdk::core::hooks::{AttemptFinishedEvent, AttemptStartedEvent, GatewayHooks};
use unigateway_sdk::core::response::RequestReport;

/// Data-plane hooks: metrics, health, usage, quota release.
pub struct SmartGateHooks {
    pub db: PgPool,
    pub metrics: Arc<DashMap<String, EndpointMetric>>,
    pub quotas: Arc<QuotaLimiter>,
    pub profiles: Arc<DashMap<String, EndpointProfile>>,
}

impl GatewayHooks for SmartGateHooks {
    fn on_attempt_started(&self, event: AttemptStartedEvent) -> BoxFuture<'static, ()> {
        let metrics = self.metrics.clone();
        let endpoint_id = event.endpoint_id.clone();
        let active = event.active_attempts_at_start;

        Box::pin(async move {
            let mut metric = metrics
                .entry(endpoint_id.clone())
                .or_insert_with(|| EndpointMetric::new(endpoint_id));
            metric.active_requests = active as i32;
            metric.total_requests += 1;
            metric.updated_at = Utc::now();
        })
    }

    fn on_attempt_finished(&self, event: AttemptFinishedEvent) -> BoxFuture<'static, ()> {
        let metrics = self.metrics.clone();
        let db = self.db.clone();
        let endpoint_id = event.endpoint_id.clone();
        let latency = event.latency_ms as f64;
        let success = event.success;

        Box::pin(async move {
            let (health_status, cooldown_until, health_changed) = {
                let mut metric = metrics
                    .entry(endpoint_id.clone())
                    .or_insert_with(|| EndpointMetric::new(endpoint_id.clone()));

                if metric.active_requests > 0 {
                    metric.active_requests -= 1;
                }

                let alpha = 0.1;
                if metric.ema_latency_ms == 0.0 {
                    metric.ema_latency_ms = latency;
                } else {
                    metric.ema_latency_ms = (1.0 - alpha) * metric.ema_latency_ms + alpha * latency;
                }

                let mut health_changed = false;

                if success {
                    if metric.ema_success_latency_ms == 0.0 {
                        metric.ema_success_latency_ms = latency;
                    } else {
                        metric.ema_success_latency_ms =
                            (1.0 - alpha) * metric.ema_success_latency_ms + alpha * latency;
                    }
                    metric.consecutive_failures = 0;
                    if metric.health_status != "healthy" {
                        metric.health_status = "healthy".to_string();
                        metric.cooldown_until = None;
                        health_changed = true;
                    }
                } else {
                    metric.total_errors += 1;
                    metric.consecutive_failures += 1;
                    metric.last_error_at = Some(Utc::now());

                    if metric.consecutive_failures >= FAILURE_THRESHOLD {
                        let until = Utc::now() + Duration::seconds(COOLDOWN_SECS);
                        metric.health_status = "unavailable".to_string();
                        metric.cooldown_until = Some(until);
                        health_changed = true;
                    } else if metric.health_status == "healthy" {
                        metric.health_status = "degraded".to_string();
                        health_changed = true;
                    }
                }

                metric.updated_at = Utc::now();
                (
                    metric.health_status.clone(),
                    metric.cooldown_until,
                    health_changed,
                )
            };

            if health_changed {
                let _ = sqlx::query(
                    "UPDATE endpoints SET health_status = $1, cooldown_until = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3",
                )
                .bind(&health_status)
                .bind(cooldown_until)
                .bind(&endpoint_id)
                .execute(&db)
                .await;
            }
        })
    }

    fn on_request_finished(&self, report: RequestReport) -> BoxFuture<'static, ()> {
        let db = self.db.clone();
        let quotas = self.quotas.clone();
        let profiles = self.profiles.clone();

        Box::pin(async move {
            if let Some(key_id) = report.metadata.get("key_id") {
                let project_id = report.metadata.get("project_id").map(|s| s.as_str());
                quotas.release(key_id, project_id);
            }

            let endpoint_id = report
                .metadata
                .get("endpoint_id")
                .cloned()
                .unwrap_or_else(|| report.selected_endpoint_id.clone());
            let selected_endpoint_id = report.selected_endpoint_id.clone();

            let estimated_input_tokens = report
                .metadata
                .get("input_tokens_est")
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(0);
            let estimated_output_tokens = report
                .metadata
                .get("output_tokens_est")
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(0);
            let provider_usage = report.usage.as_ref();
            let usage_source = if provider_usage.is_some() {
                "provider_reported"
            } else if estimated_input_tokens > 0 || estimated_output_tokens > 0 {
                "local_estimate"
            } else {
                "unavailable"
            };
            let usage_confidence = match (
                provider_usage,
                provider_usage.and_then(|usage| usage.input_tokens),
                provider_usage.and_then(|usage| usage.output_tokens),
            ) {
                (Some(_), Some(_), Some(_)) => "high",
                (Some(_), _, _) => "partial",
                (None, _, _) if usage_source == "local_estimate" => "low",
                _ => "unknown",
            };
            let prompt_tokens = provider_usage
                .and_then(|usage| usage.input_tokens)
                .unwrap_or(estimated_input_tokens);
            let completion_tokens = provider_usage
                .and_then(|usage| usage.output_tokens)
                .unwrap_or(estimated_output_tokens);
            let total_tokens = provider_usage
                .and_then(|usage| usage.total_tokens)
                .unwrap_or(prompt_tokens + completion_tokens);
            let cache_hit_tokens = provider_usage.and_then(|usage| usage.cache_hit_tokens);
            let cache_write_tokens = provider_usage.and_then(|usage| usage.cache_write_tokens);

            let (input_price, output_price, pricing_source) = profiles
                .get(&endpoint_id)
                .map(|profile| {
                    let source = if profile.price.is_priced() {
                        "configured_endpoint"
                    } else {
                        "unpriced"
                    };
                    (
                        profile.price.input_per_1m,
                        profile.price.output_per_1m,
                        source,
                    )
                })
                .unwrap_or((0.0, 0.0, "unpriced"));
            let estimated_cost = (prompt_tokens as f64 / 1_000_000.0) * input_price
                + (completion_tokens as f64 / 1_000_000.0) * output_price;

            let routing_strategy = report.metadata.get("routing_strategy").cloned();
            let routing_decision = report.metadata.get("routing_decision").cloned();
            let tool_message_chars = report
                .metadata
                .get("tool_message_chars")
                .and_then(|s| s.parse::<i32>().ok())
                .unwrap_or(0);
            let trimmed_chars = report
                .metadata
                .get("trimmed_chars")
                .and_then(|s| s.parse::<i32>().ok())
                .unwrap_or(0);

            let session_id = report.metadata.get("session_id").cloned();
            let turn_index = report
                .metadata
                .get("turn_index")
                .and_then(|s| s.parse::<i32>().ok());
            let prefix_hash = report.metadata.get("prefix_hash").cloned();
            let context_epoch = report
                .metadata
                .get("context_epoch")
                .and_then(|s| s.parse::<i32>().ok())
                .unwrap_or(0);
            let affinity_enabled = report.metadata.get("affinity_enabled") == Some(&"1".to_string());
            let affinity_applied = report.metadata.get("affinity_applied") == Some(&"1".to_string());
            let sticky_endpoint_id = report.metadata.get("sticky_endpoint_id").cloned();
            let affinity_ttl_secs = report
                .metadata
                .get("affinity_ttl_secs")
                .and_then(|s| s.parse::<i32>().ok())
                .unwrap_or(3600);
            let affinity_hit = sticky_endpoint_id
                .as_ref()
                .map(|sticky| sticky == &selected_endpoint_id)
                .unwrap_or(false);
            let prefix_hash_u64 = prefix_hash
                .as_ref()
                .and_then(|h| u64::from_str_radix(h, 16).ok());
            let ttft_ms = report
                .stream
                .as_ref()
                .and_then(|s| s.ttft_ms)
                .map(|v| v as i32);
            let cached_input_tokens = cache_hit_tokens.unwrap_or(0) as i32;

            let mut metadata_values = report.metadata.clone();
            metadata_values.insert("usage_source".to_string(), usage_source.to_string());
            metadata_values.insert("usage_confidence".to_string(), usage_confidence.to_string());
            metadata_values.insert("pricing_source".to_string(), pricing_source.to_string());
            let metadata = serde_json::to_string(&metadata_values).unwrap_or_default();
            let provider_account_id = report.metadata.get("account_id").cloned();
            let status_code = if report.error_kind.is_some() {
                502
            } else {
                200
            };
            let error_message = report.error_kind.map(|k| format!("{k:?}"));

            if status_code == 200 {
                if let (Some(sid), Some(pool_id)) = (
                    session_id.as_deref(),
                    report.metadata.get("pool_id").map(|s| s.as_str()),
                ) {
                    if affinity_enabled {
                        record_success(
                            pool_id,
                            sid,
                            context_epoch as u32,
                            &selected_endpoint_id,
                            prefix_hash_u64,
                            affinity_hit,
                            affinity_ttl_secs,
                        );
                    }
                }
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
            .bind(report.metadata.get("org_id"))
            .bind(report.metadata.get("project_id"))
            .bind(report.metadata.get("key_id"))
            .bind(report.metadata.get("virtual_model_id"))
            .bind(report.metadata.get("pool_id").cloned().or(report.pool_id.clone()))
            .bind(endpoint_id)
            .bind(provider_account_id)
            .bind(prompt_tokens as i32)
            .bind(completion_tokens as i32)
            .bind(total_tokens as i32)
            .bind(cache_hit_tokens.map(|value| value as i64))
            .bind(cache_write_tokens.map(|value| value as i64))
            .bind(report.latency_ms as i32)
            .bind(status_code)
            .bind(error_message)
            .bind(metadata)
            .bind(estimated_cost)
            .bind(routing_strategy)
            .bind(routing_decision)
            .bind(tool_message_chars)
            .bind(trimmed_chars)
            .bind(usage_source)
            .bind(usage_confidence)
            .bind(pricing_source)
            .bind(input_price)
            .bind(output_price)
            .bind(if pricing_source == "configured_endpoint" {
                Some(eero_llm_providers::registry_version())
            } else {
                None
            })
            .bind(session_id)
            .bind(turn_index)
            .bind(ttft_ms)
            .bind(cached_input_tokens)
            .bind(if affinity_applied { 1 } else { 0 })
            .bind(if affinity_hit { 1 } else { 0 })
            .bind(prefix_hash)
            .bind(context_epoch)
            .execute(&db)
            .await;

            if let Err(e) = res {
                tracing::error!("Failed to log usage: {}", e);
            }
        })
    }
}
