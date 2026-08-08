use crate::models::EndpointMetric;
use crate::quota::QuotaLimiter;
use chrono::{Duration, Utc};
use dashmap::DashMap;
use futures_util::future::BoxFuture;
use sqlx::SqlitePool;
use std::sync::Arc;
use unigateway_sdk::core::hooks::{AttemptFinishedEvent, AttemptStartedEvent, GatewayHooks};
use unigateway_sdk::core::response::RequestReport;
use crate::routing::{COOLDOWN_SECS, FAILURE_THRESHOLD};

pub struct ParaGatewayHooks {
    pub db: SqlitePool,
    pub metrics: Arc<DashMap<String, EndpointMetric>>,
    pub quotas: Arc<QuotaLimiter>,
}

impl GatewayHooks for ParaGatewayHooks {
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
                    metric.ema_latency_ms =
                        (1.0 - alpha) * metric.ema_latency_ms + alpha * latency;
                }

                let mut health_changed = false;

                if success {
                    if metric.ema_success_latency_ms == 0.0 {
                        metric.ema_success_latency_ms = latency;
                    } else {
                        metric.ema_success_latency_ms = (1.0 - alpha)
                            * metric.ema_success_latency_ms
                            + alpha * latency;
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
                    "UPDATE endpoints SET health_status = ?, cooldown_until = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
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

        Box::pin(async move {
            if let Some(key_id) = report.metadata.get("key_id") {
                let project_id = report.metadata.get("project_id").map(|s| s.as_str());
                quotas.release(key_id, project_id);
            }

            let metadata = serde_json::to_string(&report.metadata).unwrap_or_default();
            let status_code = if report.error_kind.is_some() { 502 } else { 200 };
            let error_message = report.error_kind.map(|k| format!("{k:?}"));

            let res = sqlx::query(
                "INSERT INTO usage_logs (
                    id, org_id, project_id, key_id, virtual_model_id,
                    pool_id, endpoint_id, provider_account_id,
                    prompt_tokens, completion_tokens, total_tokens,
                    latency_ms, status_code, error_message, metadata
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(uuid::Uuid::new_v4().to_string())
            .bind(report.metadata.get("org_id"))
            .bind(report.metadata.get("project_id"))
            .bind(report.metadata.get("key_id"))
            .bind(report.metadata.get("virtual_model_id"))
            .bind(report.metadata.get("pool_id").cloned().or(report.pool_id.clone()))
            .bind(
                report
                    .metadata
                    .get("endpoint_id")
                    .cloned()
                    .unwrap_or(report.selected_endpoint_id),
            )
            .bind(report.metadata.get("provider_account_id"))
            .bind(report.usage.as_ref().and_then(|u| u.input_tokens).unwrap_or(0) as i32)
            .bind(report.usage.as_ref().and_then(|u| u.output_tokens).unwrap_or(0) as i32)
            .bind(report.usage.as_ref().and_then(|u| u.total_tokens).unwrap_or(0) as i32)
            .bind(report.latency_ms as i32)
            .bind(status_code)
            .bind(error_message)
            .bind(metadata)
            .execute(&db)
            .await;

            if let Err(e) = res {
                tracing::error!("Failed to log usage: {}", e);
            }
        })
    }
}
