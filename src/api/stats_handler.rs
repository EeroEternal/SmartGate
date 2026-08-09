use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::FromRow;
use std::collections::HashMap;
use std::sync::Arc;

use crate::api::models::ApiResponse;
use crate::auth::AuthContext;
use crate::config::AppState;
use crate::policy::{effective_daily_limit, evaluate_budget, spent_today_for_key, BudgetOutcome};

#[derive(Debug, Default, Deserialize)]
pub struct StatsQuery {
    /// `24h`, `7d`, `30d`, or `all`. The default preserves the historical all-time view.
    pub range: Option<String>,
}

#[derive(Debug, FromRow)]
struct UsageStatRow {
    timestamp: chrono::DateTime<chrono::Utc>,
    project_id: Option<String>,
    project_name: Option<String>,
    key_id: Option<String>,
    key_name: Option<String>,
    virtual_model_id: Option<String>,
    virtual_model_name: Option<String>,
    pool_id: Option<String>,
    pool_name: Option<String>,
    endpoint_id: Option<String>,
    endpoint_name: Option<String>,
    provider_account_id: Option<String>,
    provider_name: Option<String>,
    prompt_tokens: i32,
    completion_tokens: i32,
    total_tokens: i32,
    latency_ms: i32,
    status_code: Option<i32>,
    estimated_cost: f64,
    routing_strategy: Option<String>,
    routing_decision: Option<String>,
    metadata: Option<String>,
    tool_message_chars: i32,
    trimmed_chars: i32,
}

#[derive(Debug, Clone, Default, Serialize)]
struct Aggregate {
    requests: i64,
    successful_requests: i64,
    failed_requests: i64,
    prompt_tokens: i64,
    completion_tokens: i64,
    total_tokens: i64,
    estimated_spend: f64,
    average_latency_ms: f64,
}

impl Aggregate {
    fn add(&mut self, row: &UsageStatRow) {
        self.requests += 1;
        if row
            .status_code
            .map(|status| (200..300).contains(&status))
            .unwrap_or(false)
        {
            self.successful_requests += 1;
        } else {
            self.failed_requests += 1;
        }
        self.prompt_tokens += row.prompt_tokens as i64;
        self.completion_tokens += row.completion_tokens as i64;
        self.total_tokens += row.total_tokens as i64;
        self.estimated_spend += row.estimated_cost;
        self.average_latency_ms += row.latency_ms as f64;
    }

    fn finish(mut self) -> Self {
        if self.requests > 0 {
            self.average_latency_ms /= self.requests as f64;
        }
        self
    }
}

fn aggregate_json(aggregate: &Aggregate) -> Value {
    let mut value = serde_json::to_value(aggregate).unwrap_or_else(|_| Value::Null);
    if let Some(object) = value.as_object_mut() {
        object.insert(
            "success_rate".to_string(),
            serde_json::json!(if aggregate.requests > 0 {
                aggregate.successful_requests as f64 / aggregate.requests as f64
            } else {
                0.0
            }),
        );
        object.insert(
            "failure_rate".to_string(),
            serde_json::json!(if aggregate.requests > 0 {
                aggregate.failed_requests as f64 / aggregate.requests as f64
            } else {
                0.0
            }),
        );
    }
    value
}

fn label(name: &Option<String>, id: &Option<String>) -> String {
    name.clone()
        .or_else(|| id.clone())
        .unwrap_or_else(|| "unknown".to_string())
}

fn percentile(latencies: &[i32], fraction: f64) -> f64 {
    if latencies.is_empty() {
        return 0.0;
    }
    let mut sorted = latencies.to_vec();
    sorted.sort_unstable();
    let index = ((sorted.len() - 1) as f64 * fraction).round() as usize;
    sorted[index.min(sorted.len() - 1)] as f64
}

fn parse_json(raw: &Option<String>) -> Option<Value> {
    raw.as_deref()
        .and_then(|value| serde_json::from_str(value).ok())
}

fn routing_signals(rows: &[&UsageStatRow]) -> (i64, i64, i64) {
    let mut fallback_requests = 0;
    let mut attempt_skip_records = 0;
    let mut downshift_requests = 0;

    for row in rows {
        let values = [parse_json(&row.routing_decision), parse_json(&row.metadata)];
        let mut fallback = false;
        let mut downshift = false;
        for value in values.into_iter().flatten() {
            for (key, item) in json_entries(&value) {
                if key == "fallback" || key == "fallback_used" {
                    fallback |= item.as_bool().unwrap_or(false);
                } else if key == "attempt_skips" {
                    attempt_skip_records += item
                        .as_array()
                        .map(|items| items.len() as i64)
                        .unwrap_or_else(|| i64::from(!item.is_null()));
                } else if key == "downshift" {
                    downshift |= item.as_bool().unwrap_or(false);
                }
            }
        }
        fallback_requests += i64::from(fallback);
        downshift_requests += i64::from(downshift);
    }

    (fallback_requests, attempt_skip_records, downshift_requests)
}

fn json_entries(value: &Value) -> Vec<(String, Value)> {
    let mut entries = Vec::new();
    match value {
        Value::Object(object) => {
            for (key, item) in object {
                entries.push((key.clone(), item.clone()));
                entries.extend(json_entries(item));
            }
        }
        Value::Array(items) => {
            for item in items {
                entries.extend(json_entries(item));
            }
        }
        _ => {}
    }
    entries
}

fn breakdown(rows: &[&UsageStatRow], dimension: fn(&UsageStatRow) -> String) -> Vec<Value> {
    let mut groups: HashMap<String, Aggregate> = HashMap::new();
    for row in rows {
        groups.entry(dimension(row)).or_default().add(row);
    }
    let mut values: Vec<(String, Aggregate)> = groups
        .into_iter()
        .map(|(name, aggregate)| (name, aggregate.finish()))
        .collect();
    values.sort_by(|a, b| {
        b.1.estimated_spend
            .total_cmp(&a.1.estimated_spend)
            .then_with(|| b.1.requests.cmp(&a.1.requests))
            .then_with(|| a.0.cmp(&b.0))
    });
    values
        .into_iter()
        .take(20)
        .map(|(name, aggregate)| {
            serde_json::json!({
                "name": name,
                "metrics": aggregate_json(&aggregate),
            })
        })
        .collect()
}

async fn health_counts(state: &AppState) -> (i32, i32, i32) {
    let health_rows: Vec<(String, i32)> =
        sqlx::query_as("SELECT health_status, COUNT(*) FROM endpoints GROUP BY health_status")
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();

    let mut healthy = 0;
    let mut degraded = 0;
    let mut unavailable = 0;
    for (status, count) in health_rows {
        match status.as_str() {
            "degraded" => degraded += count,
            "unavailable" => unavailable += count,
            _ => healthy += count,
        }
    }

    // Prefer live in-memory health once traffic has populated the metrics cache.
    if !state.metrics.is_empty() {
        healthy = 0;
        degraded = 0;
        unavailable = 0;
        for entry in state.metrics.iter() {
            match entry.health_status.as_str() {
                "degraded" => degraded += 1,
                "unavailable" => unavailable += 1,
                _ => healthy += 1,
            }
        }
    }
    (healthy, degraded, unavailable)
}

pub async fn get_stats(
    State(state): State<Arc<AppState>>,
    Query(query): Query<StatsQuery>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    let range = query.range.as_deref().unwrap_or("all");
    let since = match range {
        "24h" => Some(Utc::now() - Duration::hours(24)),
        "7d" => Some(Utc::now() - Duration::days(7)),
        "30d" => Some(Utc::now() - Duration::days(30)),
        "all" => None,
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ApiResponse::error(
                    "range must be one of: 24h, 7d, 30d, all",
                )),
            ));
        }
    };

    let rows: Vec<UsageStatRow> = if let Some(since) = since {
        sqlx::query_as(
            "SELECT u.timestamp, u.project_id, p.name AS project_name,
                    u.key_id, ak.name AS key_name,
                    u.virtual_model_id, vm.name AS virtual_model_name,
                    u.pool_id, mp.name AS pool_name,
                    u.endpoint_id, e.name AS endpoint_name,
                    u.provider_account_id, pa.name AS provider_name,
                    u.prompt_tokens, u.completion_tokens, u.total_tokens,
                    u.latency_ms, u.status_code, u.estimated_cost,
                    u.routing_strategy, u.routing_decision, u.metadata,
                    u.tool_message_chars, u.trimmed_chars
             FROM usage_logs u
             LEFT JOIN projects p ON p.id = u.project_id
             LEFT JOIN api_keys ak ON ak.id = u.key_id
             LEFT JOIN virtual_models vm ON vm.id = u.virtual_model_id
             LEFT JOIN model_pools mp ON mp.id = u.pool_id
             LEFT JOIN endpoints e ON e.id = u.endpoint_id
             LEFT JOIN provider_accounts pa ON pa.id = u.provider_account_id
             WHERE u.timestamp >= $1
             ORDER BY u.timestamp DESC",
        )
        .bind(since)
        .fetch_all(&state.db)
        .await
    } else {
        sqlx::query_as(
            "SELECT u.timestamp, u.project_id, p.name AS project_name,
                    u.key_id, ak.name AS key_name,
                    u.virtual_model_id, vm.name AS virtual_model_name,
                    u.pool_id, mp.name AS pool_name,
                    u.endpoint_id, e.name AS endpoint_name,
                    u.provider_account_id, pa.name AS provider_name,
                    u.prompt_tokens, u.completion_tokens, u.total_tokens,
                    u.latency_ms, u.status_code, u.estimated_cost,
                    u.routing_strategy, u.routing_decision, u.metadata,
                    u.tool_message_chars, u.trimmed_chars
             FROM usage_logs u
             LEFT JOIN projects p ON p.id = u.project_id
             LEFT JOIN api_keys ak ON ak.id = u.key_id
             LEFT JOIN virtual_models vm ON vm.id = u.virtual_model_id
             LEFT JOIN model_pools mp ON mp.id = u.pool_id
             LEFT JOIN endpoints e ON e.id = u.endpoint_id
             LEFT JOIN provider_accounts pa ON pa.id = u.provider_account_id
             ORDER BY u.timestamp DESC",
        )
        .fetch_all(&state.db)
        .await
    }
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::error("Database error")),
        )
    })?;

    let row_refs: Vec<&UsageStatRow> = rows.iter().collect();
    let mut summary = Aggregate::default();
    let mut latencies = Vec::with_capacity(rows.len());
    let mut hourly: HashMap<String, Aggregate> = HashMap::new();
    let mut strategy_counts: HashMap<String, i64> = HashMap::new();
    let mut status_counts: HashMap<String, i64> = HashMap::new();
    let mut tool_message_chars = 0i64;
    let mut trimmed_chars = 0i64;

    for row in &rows {
        summary.add(row);
        latencies.push(row.latency_ms);
        tool_message_chars += row.tool_message_chars as i64;
        trimmed_chars += row.trimmed_chars as i64;
        *strategy_counts
            .entry(
                row.routing_strategy
                    .clone()
                    .unwrap_or_else(|| "unknown".to_string()),
            )
            .or_default() += 1;
        let status_class = match row.status_code {
            Some(status) if (200..300).contains(&status) => "success",
            Some(status) if (400..500).contains(&status) => "client_error",
            Some(status) if status >= 500 => "server_error",
            _ => "unknown",
        };
        *status_counts.entry(status_class.to_string()).or_default() += 1;
        let timestamp = row.timestamp.to_rfc3339();
        let bucket = if range == "24h" {
            timestamp.get(..13).unwrap_or(&timestamp).replace('T', " ")
        } else {
            timestamp.get(..10).unwrap_or(&timestamp).to_string()
        };
        hourly.entry(bucket).or_default().add(row);
    }
    summary = summary.finish();

    let (fallback_requests, attempt_skip_records, downshift_requests) = routing_signals(&row_refs);
    let (healthy, degraded, unavailable) = health_counts(&state).await;
    let spend_by_key = breakdown(&row_refs, |row| label(&row.key_name, &row.key_id));
    let by_provider = breakdown(&row_refs, |row| {
        label(&row.provider_name, &row.provider_account_id)
    });
    let by_project = breakdown(&row_refs, |row| label(&row.project_name, &row.project_id));
    let by_model = breakdown(&row_refs, |row| {
        label(&row.virtual_model_name, &row.virtual_model_id)
    });
    let by_pool = breakdown(&row_refs, |row| label(&row.pool_name, &row.pool_id));
    let by_endpoint = breakdown(&row_refs, |row| label(&row.endpoint_name, &row.endpoint_id));
    let mut trend: Vec<Value> = hourly
        .into_iter()
        .map(|(period, aggregate)| {
            serde_json::json!({
                "period": period,
                "metrics": aggregate_json(&aggregate.finish()),
            })
        })
        .collect();
    trend.sort_by(|a, b| a["period"].as_str().cmp(&b["period"].as_str()));

    let spend_by_key_legacy: Vec<Value> = spend_by_key
        .iter()
        .map(|item| {
            serde_json::json!({
                "key_id": item["name"],
                "estimated_spend": item["metrics"]["estimated_spend"],
                "requests": item["metrics"]["requests"],
            })
        })
        .collect();

    Ok(Json(ApiResponse::success(serde_json::json!({
        // Existing fields remain available for current Admin UI clients.
        "total_tokens": summary.total_tokens,
        "avg_latency": summary.average_latency_ms,
        "request_count": summary.requests,
        "total_estimated_spend": summary.estimated_spend,
        "tool_message_chars": tool_message_chars,
        "trimmed_chars": trimmed_chars,
        "spend_by_key": spend_by_key_legacy,
        "endpoint_health": {
            "healthy": healthy,
            "degraded": degraded,
            "unavailable": unavailable
        },
        "period": {
            "range": range,
            "from": since.map(|value| value.to_rfc3339()),
            "to": Utc::now().to_rfc3339(),
        },
        "summary": aggregate_json(&summary),
        "latency": {
            "min_ms": latencies.iter().min().copied().unwrap_or(0),
            "max_ms": latencies.iter().max().copied().unwrap_or(0),
            "p50_ms": percentile(&latencies, 0.50),
            "p95_ms": percentile(&latencies, 0.95),
        },
        "status_counts": status_counts,
        "routing": {
            "fallback_requests": fallback_requests,
            "attempt_skip_records": attempt_skip_records,
            "downshift_requests": downshift_requests,
            "strategies": strategy_counts,
        },
        "breakdowns": {
            "providers": by_provider,
            "projects": by_project,
            "virtual_models": by_model,
            "pools": by_pool,
            "endpoints": by_endpoint,
            "api_keys": spend_by_key,
        },
        "trend": trend,
    }))))
}

/// Return usage and budget information scoped strictly to the authenticated API key.
pub async fn get_key_usage(
    State(state): State<Arc<AppState>>,
    auth: AuthContext,
    Query(query): Query<StatsQuery>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    let range = query.range.as_deref().unwrap_or("24h");
    let since = match range {
        "24h" => Some(Utc::now() - Duration::hours(24)),
        "7d" => Some(Utc::now() - Duration::days(7)),
        "30d" => Some(Utc::now() - Duration::days(30)),
        "all" => None,
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ApiResponse::error(
                    "range must be one of: 24h, 7d, 30d, all",
                )),
            ));
        }
    };

    let rows: Vec<UsageStatRow> = if let Some(since) = since {
        sqlx::query_as(
            "SELECT u.timestamp, u.project_id, p.name AS project_name,
                    u.key_id, ak.name AS key_name,
                    u.virtual_model_id, vm.name AS virtual_model_name,
                    u.pool_id, mp.name AS pool_name,
                    u.endpoint_id, e.name AS endpoint_name,
                    u.provider_account_id, pa.name AS provider_name,
                    u.prompt_tokens, u.completion_tokens, u.total_tokens,
                    u.latency_ms, u.status_code, u.estimated_cost,
                    u.routing_strategy, u.routing_decision, u.metadata,
                    u.tool_message_chars, u.trimmed_chars
             FROM usage_logs u
             LEFT JOIN projects p ON p.id = u.project_id
             LEFT JOIN api_keys ak ON ak.id = u.key_id
             LEFT JOIN virtual_models vm ON vm.id = u.virtual_model_id
             LEFT JOIN model_pools mp ON mp.id = u.pool_id
             LEFT JOIN endpoints e ON e.id = u.endpoint_id
             LEFT JOIN provider_accounts pa ON pa.id = u.provider_account_id
             WHERE u.key_id = $1 AND u.timestamp >= $2
             ORDER BY u.timestamp DESC",
        )
        .bind(&auth.api_key.id)
        .bind(since)
        .fetch_all(&state.db)
        .await
    } else {
        sqlx::query_as(
            "SELECT u.timestamp, u.project_id, p.name AS project_name,
                    u.key_id, ak.name AS key_name,
                    u.virtual_model_id, vm.name AS virtual_model_name,
                    u.pool_id, mp.name AS pool_name,
                    u.endpoint_id, e.name AS endpoint_name,
                    u.provider_account_id, pa.name AS provider_name,
                    u.prompt_tokens, u.completion_tokens, u.total_tokens,
                    u.latency_ms, u.status_code, u.estimated_cost,
                    u.routing_strategy, u.routing_decision, u.metadata,
                    u.tool_message_chars, u.trimmed_chars
             FROM usage_logs u
             LEFT JOIN projects p ON p.id = u.project_id
             LEFT JOIN api_keys ak ON ak.id = u.key_id
             LEFT JOIN virtual_models vm ON vm.id = u.virtual_model_id
             LEFT JOIN model_pools mp ON mp.id = u.pool_id
             LEFT JOIN endpoints e ON e.id = u.endpoint_id
             LEFT JOIN provider_accounts pa ON pa.id = u.provider_account_id
             WHERE u.key_id = $1
             ORDER BY u.timestamp DESC",
        )
        .bind(&auth.api_key.id)
        .fetch_all(&state.db)
        .await
    }
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::error("Database error")),
        )
    })?;

    let row_refs: Vec<&UsageStatRow> = rows.iter().collect();
    let mut summary = Aggregate::default();
    for row in &rows {
        summary.add(row);
    }
    summary = summary.finish();

    let daily_limit = effective_daily_limit(
        auth.api_key.daily_spend_limit,
        auth.project.daily_spend_limit,
    );
    let spent_today = spent_today_for_key(&state.db, &auth.api_key.id).await;
    let budget = evaluate_budget(spent_today, daily_limit);
    let (budget_status, budget_warning) = match budget {
        BudgetOutcome::Ok => ("ok", false),
        BudgetOutcome::Soft { .. } => ("soft", true),
        BudgetOutcome::Hard { .. } => ("hard", true),
    };
    let remaining = daily_limit.map(|limit| (limit - spent_today).max(0.0));
    let usage_ratio = daily_limit
        .filter(|limit| *limit > 0.0)
        .map(|limit| spent_today / limit);

    let recent_requests: Vec<Value> = rows
        .iter()
        .take(20)
        .map(|row| {
            serde_json::json!({
                "timestamp": row.timestamp,
                "virtual_model": label(&row.virtual_model_name, &row.virtual_model_id),
                "provider": label(&row.provider_name, &row.provider_account_id),
                "endpoint": label(&row.endpoint_name, &row.endpoint_id),
                "prompt_tokens": row.prompt_tokens,
                "completion_tokens": row.completion_tokens,
                "total_tokens": row.total_tokens,
                "latency_ms": row.latency_ms,
                "status_code": row.status_code,
                "estimated_spend": row.estimated_cost,
            })
        })
        .collect();

    Ok(Json(ApiResponse::success(serde_json::json!({
        "period": {
            "range": range,
            "from": since.map(|value| value.to_rfc3339()),
            "to": Utc::now().to_rfc3339(),
        },
        "api_key": {
            "name": auth.api_key.name,
            "prefix": auth.api_key.key_prefix,
            "project_id": auth.project.id,
        },
        "summary": aggregate_json(&summary),
        "budget": {
            "status": budget_status,
            "warning": budget_warning,
            "spent_today": spent_today,
            "daily_limit": daily_limit,
            "remaining_today": remaining,
            "usage_ratio": usage_ratio,
            "soft_threshold": 0.8,
            "hard_threshold": 1.0,
        },
        "breakdowns": {
            "providers": breakdown(&row_refs, |row| label(&row.provider_name, &row.provider_account_id)),
            "virtual_models": breakdown(&row_refs, |row| label(&row.virtual_model_name, &row.virtual_model_id)),
            "endpoints": breakdown(&row_refs, |row| label(&row.endpoint_name, &row.endpoint_id)),
        },
        "recent_requests": recent_requests,
    }))))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentile_uses_nearest_observation() {
        assert_eq!(percentile(&[100, 200, 300, 400], 0.50), 300.0);
        assert_eq!(percentile(&[], 0.95), 0.0);
    }

    #[test]
    fn aggregate_reports_success_rate() {
        let mut aggregate = Aggregate::default();
        let mut row = test_row(200);
        aggregate.add(&row);
        row.status_code = Some(502);
        aggregate.add(&row);
        let value = aggregate_json(&aggregate.finish());
        assert_eq!(value["requests"], 2);
        assert_eq!(value["successful_requests"], 1);
        assert_eq!(value["success_rate"], 0.5);
    }

    fn test_row(status_code: i32) -> UsageStatRow {
        UsageStatRow {
            timestamp: chrono::DateTime::parse_from_rfc3339("2026-01-01T00:00:00Z").unwrap().with_timezone(&chrono::Utc),
            project_id: None,
            project_name: None,
            key_id: None,
            key_name: None,
            virtual_model_id: None,
            virtual_model_name: None,
            pool_id: None,
            pool_name: None,
            endpoint_id: None,
            endpoint_name: None,
            provider_account_id: None,
            provider_name: None,
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
            latency_ms: 100,
            status_code: Some(status_code),
            estimated_cost: 0.01,
            routing_strategy: Some("cost_aware".to_string()),
            routing_decision: None,
            metadata: None,
            tool_message_chars: 0,
            trimmed_chars: 0,
        }
    }
}
