//! Usage analytics: overview, routing and quality analytics, and savings estimation.

use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use crate::{
    api::models::ApiResponse,
    config::AppState,
    policy::{evaluate_budget, BudgetOutcome, DIFFICULTY_HIGH_THRESHOLD, DIFFICULTY_MEDIUM_THRESHOLD},
};

use super::{db_error, range_since, RangeQuery, SaasContext};

pub(super) async fn get_usage(
    State(state): State<Arc<AppState>>,
    ctx: SaasContext,
    Query(query): Query<RangeQuery>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    let range = query.range.as_deref().unwrap_or("24h");
    let since = range_since(range)?;
    let (where_sql, since_value) = if let Some(value) = since {
        ("AND u.timestamp >= $2", Some(value))
    } else {
        ("", None)
    };
    let sql = format!("SELECT COUNT(*), COALESCE(SUM(u.prompt_tokens),0), COALESCE(SUM(u.completion_tokens),0), COALESCE(SUM(u.total_tokens),0), COALESCE(SUM(u.estimated_cost),0), COALESCE(AVG(u.latency_ms)::double precision, 0.0), COALESCE(SUM(CASE WHEN u.status_code >= 200 AND u.status_code < 300 THEN 1 ELSE 0 END),0), COALESCE(SUM(u.trimmed_chars),0), COALESCE(SUM(u.cache_hit_tokens),0)::bigint, COALESCE(SUM(CASE WHEN u.cache_hit_tokens > 0 THEN 1 ELSE 0 END),0), COUNT(u.cache_hit_tokens), COALESCE(SUM(CASE WHEN u.cache_hit_tokens IS NOT NULL THEN u.prompt_tokens ELSE 0 END),0), COALESCE(SUM(u.cache_write_tokens),0)::bigint, COALESCE(SUM(CASE WHEN u.cache_write_tokens > 0 THEN 1 ELSE 0 END),0), COUNT(u.cache_write_tokens) FROM usage_logs u JOIN projects p ON p.id = u.project_id WHERE p.org_id = $1 {where_sql}");
    let row: (i64, i64, i64, i64, f64, f64, i64, i64, i64, i64, i64, i64, i64, i64, i64) = if let Some(value) = since_value {
        sqlx::query_as(&sql)
            .bind(&ctx.org_id)
            .bind(value)
            .fetch_one(&state.db)
            .await
    } else {
        sqlx::query_as(&sql)
            .bind(&ctx.org_id)
            .fetch_one(&state.db)
            .await
    }
    .map_err(db_error)?;
    let success_rate = if row.0 > 0 {
        row.6 as f64 / row.0 as f64
    } else {
        0.0
    };
    let daily_limit: Option<f64> =
        sqlx::query_scalar("SELECT daily_spend_limit FROM projects WHERE id = $1")
            .bind(&ctx.project_id)
            .fetch_optional(&state.db)
            .await
            .map_err(db_error)?
            .flatten();
    let spent_today: f64 = sqlx::query_scalar("SELECT COALESCE(SUM(u.estimated_cost),0) FROM usage_logs u JOIN projects p ON p.id = u.project_id WHERE p.org_id = $1 AND u.timestamp >= CURRENT_DATE").bind(&ctx.org_id).fetch_one(&state.db).await.map_err(db_error)?;
    let remaining = daily_limit.map(|limit| (limit - spent_today).max(0.0));

    let breakdown_sql = format!(
        "SELECT COALESCE(pa.provider_type, 'unknown'), COALESCE(e.upstream_model_id, 'unknown'),
                COUNT(*), COALESCE(SUM(u.prompt_tokens), 0), COALESCE(SUM(u.completion_tokens), 0),
                COALESCE(SUM(u.total_tokens), 0), COALESCE(SUM(u.estimated_cost), 0),
                COALESCE(SUM(u.cache_hit_tokens), 0)::bigint,
                COALESCE(SUM(u.cache_write_tokens), 0)::bigint,
                COALESCE(SUM(CASE WHEN u.usage_source = 'provider_reported' THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN u.pricing_source <> 'unpriced' THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN u.usage_source <> 'provider_reported' THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN u.usage_source = 'local_estimate' THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN u.usage_source = 'unavailable' THEN 1 ELSE 0 END), 0)
         FROM usage_logs u
         LEFT JOIN endpoints e ON e.id = u.endpoint_id
         LEFT JOIN provider_accounts pa ON pa.id = u.provider_account_id
         JOIN projects p ON p.id = u.project_id
         WHERE p.org_id = $1 {where_sql}
         GROUP BY pa.provider_type, e.upstream_model_id",
    );
    let breakdown_rows: Vec<(
        String,
        String,
        i64,
        i64,
        i64,
        i64,
        f64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
    )> =
        if let Some(value) = since_value {
            sqlx::query_as(&breakdown_sql)
                .bind(&ctx.org_id)
                .bind(value)
                .fetch_all(&state.db)
                .await
        } else {
            sqlx::query_as(&breakdown_sql)
                .bind(&ctx.org_id)
                .fetch_all(&state.db)
                .await
        }
        .map_err(db_error)?;

    let mut provider_groups: BTreeMap<String, (i64, i64, i64, i64, f64, i64, i64)> = BTreeMap::new();
    let mut model_groups: BTreeMap<(String, String), (i64, i64, i64, i64, f64, i64, i64)> = BTreeMap::new();
    let mut provider_reported_requests = 0_i64;
    let mut priced_requests = 0_i64;
    let mut missing_usage_groups: BTreeMap<(String, String), (i64, i64, i64)> = BTreeMap::new();
    for (
        provider,
        model,
        requests,
        prompt,
        completion,
        total,
        cost,
        cache_hit,
        cache_write,
        reported,
        priced,
        missing,
        local_estimate,
        unavailable,
    ) in breakdown_rows
    {
        let provider_entry = provider_groups.entry(provider.clone()).or_default();
        provider_entry.0 += requests;
        provider_entry.1 += prompt;
        provider_entry.2 += completion;
        provider_entry.3 += total;
        provider_entry.4 += cost;
        provider_entry.5 += cache_hit;
        provider_entry.6 += cache_write;
        let model_entry = model_groups
            .entry((provider.clone(), model.clone()))
            .or_default();
        model_entry.0 += requests;
        model_entry.1 += prompt;
        model_entry.2 += completion;
        model_entry.3 += total;
        model_entry.4 += cost;
        model_entry.5 += cache_hit;
        model_entry.6 += cache_write;
        provider_reported_requests += reported;
        priced_requests += priced;
        if missing > 0 {
            missing_usage_groups
                .entry((provider, model))
                .and_modify(|entry| {
                    entry.0 += missing;
                    entry.1 += local_estimate;
                    entry.2 += unavailable;
                })
                .or_insert((missing, local_estimate, unavailable));
        }
    }
    let provider_breakdown = provider_groups
        .into_iter()
        .map(|(provider, (requests, prompt, completion, total, cost, cache_hit, cache_write))| {
            json!({"provider": provider, "requests": requests, "prompt_tokens": prompt, "completion_tokens": completion, "total_tokens": total, "cache_hit_tokens": cache_hit, "cache_write_tokens": cache_write, "estimated_spend": cost})
        })
        .collect::<Vec<_>>();
    let model_breakdown = model_groups
        .into_iter()
        .map(|((provider, model), (requests, prompt, completion, total, cost, cache_hit, cache_write))| {
            json!({"model": model, "provider": provider, "requests": requests, "prompt_tokens": prompt, "completion_tokens": completion, "total_tokens": total, "cache_hit_tokens": cache_hit, "cache_write_tokens": cache_write, "estimated_spend": cost})
        })
        .collect::<Vec<_>>();
    let missing_usage_requests = row.0 - provider_reported_requests;
    let missing_usage_breakdown = missing_usage_groups
        .into_iter()
        .map(|((provider, model), (missing, local_estimate, unavailable))| {
            json!({
                "provider": provider,
                "model": model,
                "requests": missing,
                "local_estimate_requests": local_estimate,
                "unavailable_requests": unavailable,
            })
        })
        .collect::<Vec<_>>();
    let usage_coverage = if row.0 > 0 {
        provider_reported_requests as f64 / row.0 as f64
    } else {
        0.0
    };
    let pricing_coverage = if row.0 > 0 {
        priced_requests as f64 / row.0 as f64
    } else {
        0.0
    };
    let cache_hit_rate = if row.11 > 0 {
        row.8 as f64 / row.11 as f64
    } else {
        0.0
    };
    let cache_write_rate = if row.1 > 0 {
        row.12 as f64 / row.1 as f64
    } else {
        0.0
    };
    let mut data_quality = Vec::new();
    if usage_coverage < 1.0 {
        data_quality.push("Some requests did not include provider-reported token usage; those records use local estimates or are unavailable.");
    }
    if pricing_coverage < 1.0 {
        data_quality.push(
            "Some models do not have configured pricing, so estimated spend may be incomplete.",
        );
    }
    if row.10 == 0 {
        data_quality.push("No provider-reported cache metrics were recorded for this period.");
    }
    Ok(Json(ApiResponse::success(
        json!({"range": range, "requests": row.0, "prompt_tokens": row.1, "completion_tokens": row.2, "total_tokens": row.3, "estimated_spend": row.4, "average_latency_ms": row.5, "success_rate": success_rate, "trimmed_chars": row.7, "cache": {"hit_tokens": row.8, "hit_requests": row.9, "reported_requests": row.10, "reported_input_tokens": row.11, "hit_rate": cache_hit_rate, "write_tokens": row.12, "write_requests": row.13, "reported_write_requests": row.14, "write_rate": cache_write_rate}, "budget": {"spent_today": spent_today, "daily_limit": daily_limit, "remaining_today": remaining, "status": match evaluate_budget(spent_today, daily_limit) { BudgetOutcome::Ok => "ok", BudgetOutcome::Soft { .. } => "soft", BudgetOutcome::Hard { .. } => "hard" }}, "coverage": {"usage": usage_coverage, "pricing": pricing_coverage, "provider_reported_requests": provider_reported_requests, "priced_requests": priced_requests, "missing_usage_requests": missing_usage_requests, "missing_usage_breakdown": missing_usage_breakdown}, "data_quality": data_quality, "breakdowns": {"providers": provider_breakdown, "models": model_breakdown}}),
    )))
}

#[derive(Debug, Deserialize)]
pub(super) struct AnalyticsQuery {
    range: Option<String>,
}

pub(super) async fn get_routing_analytics(
    State(state): State<Arc<AppState>>,
    ctx: SaasContext,
    Query(query): Query<AnalyticsQuery>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    let range = query.range.as_deref().unwrap_or("24h");
    let since = range_since(range)?;
    let (where_sql, since_value) = if let Some(value) = since {
        ("AND u.timestamp >= $2", Some(value))
    } else {
        ("", None)
    };

    let logs_sql = format!(
        "SELECT u.id, u.timestamp, COALESCE(vm.name, 'default'),
                COALESCE(e.upstream_model_id, 'unknown'),
                COALESCE(pa.name, pa.provider_type, 'unknown'),
                u.prompt_tokens, u.completion_tokens, u.total_tokens,
                u.latency_ms, u.status_code, u.estimated_cost,
                u.routing_strategy, u.routing_decision, u.metadata
         FROM usage_logs u
         JOIN projects p ON p.id = u.project_id
         LEFT JOIN virtual_models vm ON vm.id = u.virtual_model_id
         LEFT JOIN endpoints e ON e.id = u.endpoint_id
         LEFT JOIN provider_accounts pa ON pa.id = u.provider_account_id
         WHERE p.org_id = $1 {where_sql}
         ORDER BY u.timestamp DESC
         LIMIT 100"
    );

    let rows: Vec<(
        String,
        chrono::DateTime<chrono::Utc>,
        String,
        String,
        String,
        i32,
        i32,
        i32,
        i32,
        Option<i32>,
        f64,
        Option<String>,
        Option<String>,
        Option<String>,
    )> = if let Some(value) = since_value {
        sqlx::query_as(&logs_sql)
            .bind(&ctx.org_id)
            .bind(value)
            .fetch_all(&state.db)
            .await
    } else {
        sqlx::query_as(&logs_sql)
            .bind(&ctx.org_id)
            .fetch_all(&state.db)
            .await
    }
    .map_err(db_error)?;

    // Candidate ids are meaningless to operators; resolve them to model names once.
    let endpoint_names: HashMap<String, String> = sqlx::query_as::<_, (String, String)>(
        "SELECT e.id, e.upstream_model_id
         FROM endpoints e
         JOIN provider_accounts pa ON pa.id = e.account_id
         WHERE pa.org_id = $1",
    )
    .bind(&ctx.org_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default()
    .into_iter()
    .collect();

    let mut high_count = 0usize;
    let mut medium_count = 0usize;
    let mut low_count = 0usize;
    let mut pro_count = 0usize;
    let mut flash_count = 0usize;
    let mut total_cost = 0.0;
    let mut total_latency = 0i64;
    let mut total_tokens = 0i64;
    let total_queries = rows.len();

    let mut queries = Vec::new();
    for (
        id,
        timestamp,
        service_name,
        model,
        provider_name,
        prompt_tokens,
        completion_tokens,
        tokens,
        latency_ms,
        status_code,
        cost,
        strategy,
        decision_str,
        metadata_str,
    ) in rows {
        total_cost += cost;
        total_latency += latency_ms as i64;
        total_tokens += tokens as i64;

        let is_pro = model.to_lowercase().contains("pro")
            || model.to_lowercase().contains("reasoner")
            || model.to_lowercase().contains("opus")
            || model.to_lowercase().contains("sonnet")
            || model.to_lowercase().contains("gpt-4");
        if is_pro {
            pro_count += 1;
        } else {
            flash_count += 1;
        }

        let mut difficulty = if is_pro { 0.85 } else { 0.20 };
        let mut difficulty_tier = if is_pro { "high" } else { "low" };
        let mut prompt_preview = String::new();
        let mut signals = Vec::new();
        let mut candidates: Vec<Value> = Vec::new();

        if let Some(ref d_str) = decision_str {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(d_str) {
                if let Some(d) = val.get("difficulty").and_then(|v| v.as_f64()) {
                    difficulty = d;
                    difficulty_tier = if d >= DIFFICULTY_HIGH_THRESHOLD {
                        "high"
                    } else if d >= DIFFICULTY_MEDIUM_THRESHOLD {
                        "medium"
                    } else {
                        "low"
                    };
                }
                if let Some(p) = val.get("prompt_preview").and_then(|v| v.as_str()) {
                    prompt_preview = p.to_string();
                }
                if let Some(sigs) = val.get("signals").and_then(|v| v.as_array()) {
                    for s in sigs {
                        if let Some(s_str) = s.as_str() {
                            signals.push(s_str.to_string());
                        }
                    }
                }
                if let Some(items) = val.get("candidates").and_then(|v| v.as_array()) {
                    for item in items {
                        let endpoint_id = item
                            .get("endpoint_id")
                            .and_then(|v| v.as_str())
                            .unwrap_or_default();
                        candidates.push(json!({
                            "model": endpoint_names
                                .get(endpoint_id)
                                .cloned()
                                .unwrap_or_else(|| endpoint_id.to_string()),
                            "capability": item.get("capability").and_then(|v| v.as_f64()),
                            "excluded": item.get("excluded").and_then(|v| v.as_bool()).unwrap_or(false),
                            "exclusion_reason": item.get("exclusion_reason").and_then(|v| v.as_str()).unwrap_or(""),
                        }));
                    }
                }
            }
        }

        match difficulty_tier {
            "high" => high_count += 1,
            "medium" => medium_count += 1,
            _ => low_count += 1,
        }

        if signals.is_empty() {
            if is_pro {
                signals.push("Complex reasoning".to_string());
            } else if prompt_tokens > 4000 {
                signals.push("Long context".to_string());
            } else {
                signals.push("General query".to_string());
            }
        }

        let clean_service_name = if service_name.len() > 37 && service_name.chars().nth(36) == Some('-') {
            service_name[37..].to_string()
        } else {
            service_name.clone()
        };

        if prompt_preview.is_empty() {
            prompt_preview = format!("{} tokens query via {}", prompt_tokens, clean_service_name);
        }

        // A stronger endpoint may have been tried first and failed; without the
        // attempt chain the log looks like the request was never routed there.
        let metadata = metadata_str
            .as_deref()
            .and_then(|raw| serde_json::from_str::<Value>(raw).ok());
        let attempts = metadata
            .as_ref()
            .and_then(|value| value.get("attempts"))
            .and_then(|value| value.as_str())
            .map(|value| {
                value
                    .split(',')
                    .filter(|item| !item.is_empty())
                    .map(|item| item.to_string())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let fallback_used = attempts.len() > 1;

        queries.push(json!({
            "id": id,
            "timestamp": timestamp.format("%Y-%m-%d %H:%M:%S").to_string(),
            "service_name": clean_service_name,
            "model": model,
            "provider_name": provider_name,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": tokens,
            "latency_ms": latency_ms,
            "status_code": status_code.unwrap_or(200),
            "cost": cost,
            "strategy": strategy.unwrap_or_else(|| "capability_aware".to_string()),
            "difficulty": (difficulty * 100.0).round() / 100.0,
            "difficulty_tier": difficulty_tier,
            "prompt_preview": prompt_preview,
            "signals": signals,
            "attempts": attempts,
            "fallback_used": fallback_used,
            "candidates": candidates,
        }));
    }

    let estimated_savings = flash_count as f64 * 0.0020;
    let avg_latency = if total_queries > 0 {
        (total_latency as f64 / total_queries as f64).round() as i64
    } else {
        0
    };

    Ok(Json(ApiResponse::success(json!({
        "range": range,
        "summary": {
            "total_queries": total_queries,
            "high_tier_count": high_count,
            "medium_tier_count": medium_count,
            "low_tier_count": low_count,
            "pro_count": pro_count,
            "flash_count": flash_count,
            "total_cost": total_cost,
            "estimated_savings": estimated_savings,
            "avg_latency_ms": avg_latency,
            "total_tokens": total_tokens,
        },
        "queries": queries,
    }))))
}

#[derive(Debug, sqlx::FromRow)]
struct QualityAnalyticsRow {
    id: String,
    timestamp: chrono::DateTime<chrono::Utc>,
    virtual_model_id: String,
    endpoint_id: String,
    service_name: String,
    model: String,
    provider_name: String,
    prompt_tokens: i32,
    completion_tokens: i32,
    total_tokens: i32,
    latency_ms: i32,
    status_code: Option<i32>,
    estimated_cost: f64,
    routing_strategy: Option<String>,
    routing_decision: Option<String>,
    metadata: Option<String>,
    trimmed_chars: i32,
    tool_message_chars: i32,
}

pub(super) async fn get_quality_analytics(
    State(state): State<Arc<AppState>>,
    ctx: SaasContext,
    Query(query): Query<AnalyticsQuery>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    let range = query.range.as_deref().unwrap_or("24h");
    let since = range_since(range)?;
    let (where_sql, since_value) = if let Some(value) = since {
        ("AND u.timestamp >= $2", Some(value))
    } else {
        ("", None)
    };

    let logs_sql = format!(
        "SELECT u.id, u.timestamp, COALESCE(vm.id, '') AS virtual_model_id, COALESCE(e.id, '') AS endpoint_id, COALESCE(vm.name, 'default') AS service_name,
                COALESCE(e.upstream_model_id, 'unknown') AS model,
                COALESCE(pa.name, pa.provider_type, 'unknown') AS provider_name,
                u.prompt_tokens, u.completion_tokens, u.total_tokens,
                u.latency_ms, u.status_code, u.estimated_cost,
                u.routing_strategy, u.routing_decision, u.metadata, u.trimmed_chars,
                u.tool_message_chars
         FROM usage_logs u
         JOIN projects p ON p.id = u.project_id
         LEFT JOIN virtual_models vm ON vm.id = u.virtual_model_id
         LEFT JOIN endpoints e ON e.id = u.endpoint_id
         LEFT JOIN provider_accounts pa ON pa.id = u.provider_account_id
         WHERE p.org_id = $1 {where_sql}
         ORDER BY u.timestamp DESC
         LIMIT 100"
    );

    let rows: Vec<QualityAnalyticsRow> = if let Some(value) = since_value {
        sqlx::query_as(&logs_sql)
            .bind(&ctx.org_id)
            .bind(value)
            .fetch_all(&state.db)
            .await
    } else {
        sqlx::query_as(&logs_sql)
            .bind(&ctx.org_id)
            .fetch_all(&state.db)
            .await
    }
    .map_err(db_error)?;

    let mut total_cost = 0.0;
    let mut total_latency = 0i64;
    let mut latencies: Vec<i32> = Vec::new();
    let mut total_prompt_tokens = 0i64;
    let mut total_completion_tokens = 0i64;
    let mut total_trimmed_chars = 0i64;
    let mut correction_count = 0usize;
    let mut successful_count = 0usize;
    let mut pro_count = 0usize;
    let mut flash_count = 0usize;
    let mut schema_request_count = 0usize;
    let mut schema_success_count = 0usize;

    let mut baseline_cost = 0.0;
    let mut baseline_latency = 0i64;
    let mut baseline_latencies: Vec<i32> = Vec::new();
    let mut baseline_prompt_tokens = 0i64;
    let mut baseline_completion_tokens = 0i64;
    let mut baseline_trimmed_chars = 0i64;
    let mut baseline_correction_count = 0usize;
    let mut baseline_successful_count = 0usize;
    let mut baseline_schema_request_count = 0usize;
    let mut baseline_schema_success_count = 0usize;
    let mut baseline_queries = 0usize;

    let total_queries = rows.len();
    let mut quality_records = Vec::new();

    let baseline_config = load_savings_baseline(&state, &ctx)
        .await
        .map_err(db_error)?;
    let baseline_pair = baseline_config.as_ref().map(|row| (row.0.clone(), row.1.clone()));

    for QualityAnalyticsRow {
        id,
        timestamp,
        virtual_model_id,
        endpoint_id,
        service_name,
        model,
        provider_name,
        prompt_tokens,
        completion_tokens,
        total_tokens: tokens,
        latency_ms,
        status_code,
        estimated_cost: cost,
        routing_strategy: _,
        routing_decision: decision_str,
        metadata: _,
        trimmed_chars,
        tool_message_chars,
    } in rows {
        let is_baseline = baseline_pair.as_ref() == Some(&(virtual_model_id.clone(), endpoint_id.clone()));

        total_cost += cost;
        total_latency += latency_ms as i64;
        latencies.push(latency_ms);
        total_prompt_tokens += prompt_tokens as i64;
        total_completion_tokens += completion_tokens as i64;
        total_trimmed_chars += trimmed_chars as i64;

        if is_baseline {
            baseline_cost += cost;
            baseline_latency += latency_ms as i64;
            baseline_latencies.push(latency_ms);
            baseline_prompt_tokens += prompt_tokens as i64;
            baseline_completion_tokens += completion_tokens as i64;
            baseline_trimmed_chars += trimmed_chars as i64;
            baseline_queries += 1;
        }

        let is_pro = model.to_lowercase().contains("pro")
            || model.to_lowercase().contains("reasoner")
            || model.to_lowercase().contains("opus")
            || model.to_lowercase().contains("sonnet")
            || model.to_lowercase().contains("max")
            || model.to_lowercase().contains("gpt-4");

        if is_pro {
            pro_count += 1;
        } else {
            flash_count += 1;
        }

        let status = status_code.unwrap_or(200);
        if status == 200 {
            successful_count += 1;
            if is_baseline {
                baseline_successful_count += 1;
            }
        }

        if tool_message_chars > 0 {
            schema_request_count += 1;
            if is_baseline {
                baseline_schema_request_count += 1;
            }
            if status == 200 {
                schema_success_count += 1;
                if is_baseline {
                    baseline_schema_success_count += 1;
                }
            }
        }

        let mut prompt_preview = String::new();
        let mut signals = Vec::new();

        if let Some(ref d_str) = decision_str {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(d_str) {
                if let Some(p) = val.get("prompt_preview").and_then(|v| v.as_str()) {
                    prompt_preview = p.to_string();
                }
                if let Some(sigs) = val.get("signals").and_then(|v| v.as_array()) {
                    for s in sigs {
                        if let Some(s_str) = s.as_str() {
                            signals.push(s_str.to_string());
                        }
                    }
                }
            }
        }

        let is_correction = signals.iter().any(|s| s.contains("Correction") || s.contains("Follow-up") || s.contains("Clarification"));
        if is_correction {
            correction_count += 1;
            if is_baseline {
                baseline_correction_count += 1;
            }
        }

        let (verdict, feedback_source, verdict_desc) = if status < 200 || status >= 300 {
            (
                "error",
                "Request telemetry",
                "Request failed; no independent quality score is available",
            )
        } else if is_correction {
            (
                "escalated",
                "Routing telemetry",
                "A correction signal was observed; this is not independent quality validation",
            )
        } else {
            (
                "completed",
                "Request telemetry",
                "Request completed successfully; no independent quality score is available",
            )
        };

        let clean_service_name = service_name.replace(|c: char| c == '-' && c.is_ascii_punctuation(), "-");
        quality_records.push(json!({
            "id": id,
            "timestamp": timestamp.format("%Y-%m-%d %H:%M:%S").to_string(),
            "service_name": clean_service_name,
            "model": model,
            "provider_name": provider_name,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": tokens,
            "latency_ms": latency_ms,
            "status_code": status,
            "cost": cost,
            "prompt_preview": prompt_preview,
            "verdict": verdict,
            "verdict_desc": verdict_desc,
            "feedback_source": feedback_source,
            "is_baseline": is_baseline,
        }));
    }

    let treatment_queries = total_queries.saturating_sub(baseline_queries);
    let actual_avg_cost = (treatment_queries > 0)
        .then(|| (total_cost / treatment_queries as f64 * 10_000.0).round() / 10_000.0);
    let actual_avg_latency = (treatment_queries > 0)
        .then(|| (total_latency as f64 / treatment_queries as f64).round() as i64);
    let p90_latency = profile_percentile(&latencies, 0.90).map(|value| value.round() as i64);
    let treatment_successful_count = successful_count.saturating_sub(baseline_successful_count);
    let treatment_correction_count = correction_count.saturating_sub(baseline_correction_count);
    let treatment_schema_success_count = schema_success_count.saturating_sub(baseline_schema_success_count);
    let user_correction_rate = (treatment_queries > 0).then(|| {
        (treatment_correction_count as f64 / treatment_queries as f64 * 100.0 * 10.0).round() / 10.0
    });
    let success_rate = (treatment_queries > 0).then(|| {
        (treatment_successful_count as f64 / treatment_queries as f64 * 100.0 * 10.0).round() / 10.0
    });
    let schema_compliance_rate = (schema_request_count > baseline_schema_request_count).then(|| {
        (treatment_schema_success_count as f64 / (schema_request_count - baseline_schema_request_count) as f64 * 100.0 * 10.0).round() / 10.0
    });

    let baseline_avg_cost = (baseline_queries > 0)
        .then(|| (baseline_cost / baseline_queries as f64 * 10_000.0).round() / 10_000.0);
    let baseline_avg_latency = (baseline_queries > 0)
        .then(|| (baseline_latency as f64 / baseline_queries as f64).round() as i64);
    let baseline_p90_latency = profile_percentile(&baseline_latencies, 0.90).map(|value| value.round() as i64);
    let baseline_correction_rate = (baseline_queries > 0).then(|| {
        (baseline_correction_count as f64 / baseline_queries as f64 * 100.0 * 10.0).round() / 10.0
    });
    let baseline_success_rate = (baseline_queries > 0).then(|| {
        (baseline_successful_count as f64 / baseline_queries as f64 * 100.0 * 10.0).round() / 10.0
    });
    let baseline_schema_compliance_rate = (baseline_schema_request_count > 0).then(|| {
        (baseline_schema_success_count as f64 / baseline_schema_request_count as f64 * 100.0 * 10.0).round() / 10.0
    });

    let quality_preserved_rate = if baseline_queries > 0 && treatment_queries > 0 {
        let baseline_rate = baseline_successful_count as f64 / baseline_queries as f64;
        let treatment_rate = treatment_successful_count as f64 / treatment_queries as f64;
        if baseline_rate > 0.0 {
            Some(((treatment_rate / baseline_rate * 100.0) * 10.0).round() / 10.0)
        } else {
            None
        }
    } else {
        None
    };

    let speedup_pct = if baseline_avg_latency.is_some() && baseline_avg_latency.unwrap() > 0 && actual_avg_latency.is_some() {
        let baseline_ms = baseline_avg_latency.unwrap() as f64;
        let actual_ms = actual_avg_latency.unwrap() as f64;
        Some((((baseline_ms - actual_ms) / baseline_ms * 100.0) * 10.0).round() / 10.0)
    } else {
        None
    };

    // Shadow Flighting: compute agreement rate from recorded shadow evaluations.
    let shadow_eval_sql = format!(
        "SELECT COALESCE(COUNT(*), 0), COALESCE(SUM(agreement), 0)
         FROM shadow_evaluations
         WHERE project_id = $1 {where_sql}"
    );
    let (shadow_total, shadow_agreed): (i64, i64) = if let Some(value) = since_value {
        sqlx::query_as(&shadow_eval_sql)
            .bind(&ctx.project_id)
            .bind(value)
            .fetch_one(&state.db)
            .await
    } else {
        sqlx::query_as(&shadow_eval_sql)
            .bind(&ctx.project_id)
            .fetch_one(&state.db)
            .await
    }
    .map_err(db_error)?;
    let shadow_agreement_score = (shadow_total > 0).then(|| {
        (shadow_agreed as f64 / shadow_total as f64 * 100.0 * 10.0).round() / 10.0
    });

    let comparison_status = if baseline_config.is_some() { "available" } else { "unavailable" };
    let (baseline_summary, cost_saved_pct) = match &baseline_config {
        Some((virtual_model_id, endpoint_id, service_name, model, provider_name, _input_price, _output_price)) => {
            (
                json!({
                    "name": format!("{service_name} · {model}"),
                    "virtual_model_id": virtual_model_id,
                    "endpoint_id": endpoint_id,
                    "model": model,
                    "provider_name": provider_name,
                    "cost_per_req": baseline_avg_cost,
                    "avg_latency_ms": baseline_avg_latency,
                    "p90_latency_ms": baseline_p90_latency,
                    "task_success_rate": baseline_success_rate,
                    "correction_rate": baseline_correction_rate,
                    "schema_compliance_rate": baseline_schema_compliance_rate,
                }),
                cost_saved_percentage(baseline_cost, total_cost),
            )
        }
        None => (Value::Null, None),
    };

    Ok(Json(ApiResponse::success(json!({
        "range": range,
        "summary": {
            "total_queries": total_queries,
            "comparison_status": comparison_status,
            "quality_preserved_rate": quality_preserved_rate,
            "user_correction_rate": user_correction_rate,
            "schema_compliance_rate": schema_compliance_rate,
            "shadow_agreement_score": shadow_agreement_score,
            "pro_count": pro_count,
            "flash_count": flash_count,
            "baseline": baseline_summary,
            "smartgate_routing": {
                "name": "SmartGate Intelligent Routing",
                "cost_per_req": actual_avg_cost,
                "avg_latency_ms": actual_avg_latency,
                "p90_latency_ms": p90_latency,
                "task_success_rate": success_rate,
                "correction_rate": user_correction_rate,
                "schema_compliance_rate": schema_compliance_rate,
                "cost_saved_pct": cost_saved_pct,
                "speedup_pct": speedup_pct,
            }
        },
        "records": quality_records,
    }))))
}

fn profile_percentile(values: &[i32], fraction: f64) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    let index = ((sorted.len() - 1) as f64 * fraction).round() as usize;
    Some(sorted[index.min(sorted.len() - 1)] as f64)
}

type SavingsBaselineRow = (String, String, String, String, String, f64, f64);

async fn load_savings_baseline(
    state: &AppState,
    ctx: &SaasContext,
) -> Result<Option<SavingsBaselineRow>, sqlx::Error> {
    let baseline = sqlx::query_as::<_, SavingsBaselineRow>(
        "SELECT sb.virtual_model_id, sb.endpoint_id, vm.name, e.upstream_model_id,
                pa.name, e.input_price_per_1m, e.output_price_per_1m
         FROM savings_baselines sb
         JOIN virtual_models vm ON vm.id = sb.virtual_model_id
         JOIN model_pools mp ON mp.id = vm.pool_id
         JOIN project_model_grants g ON g.virtual_model_id = vm.id AND g.project_id = sb.project_id
         JOIN model_pool_endpoints mpe ON mpe.pool_id = mp.id
         JOIN endpoints e ON e.id = mpe.endpoint_id
         JOIN provider_accounts pa ON pa.id = e.account_id
         WHERE sb.project_id = $1 AND mp.org_id = $2 AND mpe.endpoint_id = sb.endpoint_id",
    )
    .bind(&ctx.project_id)
    .bind(&ctx.org_id)
    .fetch_optional(&state.db)
    .await?;
    if baseline.is_some() {
        return Ok(baseline);
    }

    // Pick a stable default on first access. Prefer priced endpoints so the
    // default is useful for savings estimation, then randomize among peers.
    let candidate: Option<(String, String)> = sqlx::query_as(
        "SELECT vm.id, e.id
         FROM virtual_models vm
         JOIN model_pools mp ON mp.id = vm.pool_id
         JOIN project_model_grants g ON g.virtual_model_id = vm.id AND g.project_id = $2
         JOIN model_pool_endpoints mpe ON mpe.pool_id = mp.id
         JOIN endpoints e ON e.id = mpe.endpoint_id
         WHERE mp.org_id = $1 AND e.enabled = TRUE
         ORDER BY (e.input_price_per_1m > 0 OR e.output_price_per_1m > 0) DESC, RANDOM()
         LIMIT 1",
    )
    .bind(&ctx.org_id)
    .bind(&ctx.project_id)
    .fetch_optional(&state.db)
    .await?;
    if let Some((virtual_model_id, endpoint_id)) = candidate {
        sqlx::query(
            "INSERT INTO savings_baselines (project_id, virtual_model_id, endpoint_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (project_id) DO NOTHING",
        )
        .bind(&ctx.project_id)
        .bind(virtual_model_id)
        .bind(endpoint_id)
        .execute(&state.db)
        .await?;

        // Re-read the row so concurrent first requests return the same
        // persisted baseline rather than their own random candidate.
        return sqlx::query_as::<_, SavingsBaselineRow>(
            "SELECT sb.virtual_model_id, sb.endpoint_id, vm.name, e.upstream_model_id,
                    pa.name, e.input_price_per_1m, e.output_price_per_1m
             FROM savings_baselines sb
             JOIN virtual_models vm ON vm.id = sb.virtual_model_id
             JOIN model_pools mp ON mp.id = vm.pool_id
             JOIN project_model_grants g ON g.virtual_model_id = vm.id AND g.project_id = sb.project_id
             JOIN model_pool_endpoints mpe ON mpe.pool_id = mp.id
             JOIN endpoints e ON e.id = mpe.endpoint_id
             JOIN provider_accounts pa ON pa.id = e.account_id
             WHERE sb.project_id = $1 AND mp.org_id = $2 AND mpe.endpoint_id = sb.endpoint_id",
        )
        .bind(&ctx.project_id)
        .bind(&ctx.org_id)
        .fetch_optional(&state.db)
        .await;
    }

    Ok(None)
}

pub(super) async fn get_savings_baseline(
    State(state): State<Arc<AppState>>,
    ctx: SaasContext,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    let baseline = load_savings_baseline(&state, &ctx)
        .await
        .map_err(db_error)?;

    let Some((virtual_model_id, endpoint_id, service_name, model, provider_name, input_price, output_price)) = baseline else {
        return Ok(Json(ApiResponse::success(json!({"configured": false}))));
    };
    Ok(Json(ApiResponse::success(json!({
        "configured": true,
        "virtual_model_id": virtual_model_id,
        "endpoint_id": endpoint_id,
        "model_service_name": service_name,
        "model": model,
        "provider_name": provider_name,
        "input_price_per_1m": input_price,
        "output_price_per_1m": output_price,
    }))))
}

pub(super) async fn update_savings_baseline(
    State(state): State<Arc<AppState>>,
    ctx: SaasContext,
    Json(input): Json<SavingsBaselineRequest>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    let valid: Option<(String,)> = sqlx::query_as(
        "SELECT e.id
         FROM virtual_models vm
         JOIN model_pools mp ON mp.id = vm.pool_id
         JOIN project_model_grants g ON g.virtual_model_id = vm.id AND g.project_id = $4
         JOIN model_pool_endpoints mpe ON mpe.pool_id = mp.id
         JOIN endpoints e ON e.id = mpe.endpoint_id
         WHERE vm.id = $1 AND e.id = $2 AND mp.org_id = $3",
    )
    .bind(&input.virtual_model_id)
    .bind(&input.endpoint_id)
    .bind(&ctx.org_id)
    .bind(&ctx.project_id)
    .fetch_optional(&state.db)
    .await
    .map_err(db_error)?;
    if valid.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error("The selected model endpoint is not available to this project")),
        ));
    }

    sqlx::query(
        "INSERT INTO savings_baselines (project_id, virtual_model_id, endpoint_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (project_id) DO UPDATE SET
           virtual_model_id = EXCLUDED.virtual_model_id,
           endpoint_id = EXCLUDED.endpoint_id,
           updated_at = CURRENT_TIMESTAMP",
    )
    .bind(&ctx.project_id)
    .bind(&input.virtual_model_id)
    .bind(&input.endpoint_id)
    .execute(&state.db)
    .await
    .map_err(db_error)?;

    Ok(Json(ApiResponse::success(json!({"updated": true}))))
}

#[derive(Debug, Deserialize)]
pub(super) struct SavingsBaselineRequest {
    virtual_model_id: String,
    endpoint_id: String,
}

pub(super) async fn get_savings(
    State(state): State<Arc<AppState>>,
    ctx: SaasContext,
    Query(query): Query<RangeQuery>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    let range = query.range.as_deref().unwrap_or("24h");
    let since = range_since(range)?;
    let baseline = load_savings_baseline(&state, &ctx)
        .await
        .map_err(db_error)?;

    let Some((virtual_model_id, endpoint_id, service_name, model, provider_name, input_price, output_price)) = baseline else {
        return Ok(Json(ApiResponse::success(json!({
            "estimated_spend": Value::Null,
            "estimated_savings": Value::Null,
            "trimmed_chars": 0,
            "configured": false,
            "basis": "Configure a model service baseline to estimate dollar savings from context reduction and cost-aware routing.",
            "is_estimated": true,
        }))));
    };
    if input_price <= 0.0 && output_price <= 0.0 {
        return Ok(Json(ApiResponse::success(json!({
            "estimated_spend": Value::Null,
            "estimated_savings": Value::Null,
            "trimmed_chars": 0,
            "configured": true,
            "baseline": {"virtual_model_id": virtual_model_id, "endpoint_id": endpoint_id, "model_service_name": service_name, "model": model, "provider_name": provider_name, "input_price_per_1m": input_price, "output_price_per_1m": output_price},
            "basis": "Add input or output pricing to the selected model endpoint to estimate dollar savings.",
            "is_estimated": true,
        }))));
    }

    let (where_sql, since_value) = if since.is_some() {
        ("AND u.timestamp >= $3", since)
    } else {
        ("", None)
    };
    let sql = format!(
        "SELECT COALESCE(SUM(u.prompt_tokens), 0),
                COALESCE(SUM(u.completion_tokens), 0),
                COALESCE(SUM(u.trimmed_chars), 0),
                COALESCE(SUM(u.estimated_cost), 0)
         FROM usage_logs u JOIN projects p ON p.id = u.project_id
         WHERE p.org_id = $1 AND u.virtual_model_id = $2 {where_sql}"
    );
    let usage: (i64, i64, i64, f64) = if let Some(value) = since_value {
        sqlx::query_as(&sql)
            .bind(&ctx.org_id)
            .bind(&virtual_model_id)
            .bind(value)
            .fetch_one(&state.db)
            .await
    } else {
        sqlx::query_as(&sql)
            .bind(&ctx.org_id)
            .bind(&virtual_model_id)
            .fetch_one(&state.db)
            .await
    }
    .map_err(db_error)?;
    let (baseline_cost, estimated_savings) = calculate_savings(
        usage.0,
        usage.1,
        usage.2,
        usage.3,
        input_price,
        output_price,
    );

    Ok(Json(ApiResponse::success(json!({
        "estimated_spend": usage.3,
        "estimated_savings": estimated_savings,
        "baseline_cost": baseline_cost,
        "trimmed_chars": usage.2,
        "configured": true,
        "baseline": {"virtual_model_id": virtual_model_id, "endpoint_id": endpoint_id, "model_service_name": service_name, "model": model, "provider_name": provider_name, "input_price_per_1m": input_price, "output_price_per_1m": output_price},
        "basis": "Estimated against the selected model service endpoint using recorded tokens and restored trimmed context; actual provider billing may differ.",
        "is_estimated": true,
    }))))
}

fn calculate_savings(
    prompt_tokens: i64,
    completion_tokens: i64,
    trimmed_chars: i64,
    estimated_spend: f64,
    input_price_per_1m: f64,
    output_price_per_1m: f64,
) -> (f64, f64) {
    let restored_prompt_tokens = trimmed_chars as f64 / 4.0;
    let baseline_cost = ((prompt_tokens as f64 + restored_prompt_tokens) / 1_000_000.0)
        * input_price_per_1m
        + (completion_tokens as f64 / 1_000_000.0) * output_price_per_1m;
    (baseline_cost, baseline_cost - estimated_spend)
}

/// Percentage of spend saved by actual routing versus the baseline, rounded to one decimal.
fn cost_saved_percentage(actual_spend: f64, baseline_spend: f64) -> Option<f64> {
    (baseline_spend > 0.0).then(|| {
        (((1.0 - actual_spend / baseline_spend) * 100.0) * 10.0).round() / 10.0
    })
}

#[cfg(test)]
mod tests {
    use super::{calculate_savings, cost_saved_percentage};

    #[test]
    fn savings_baseline_restores_trimmed_prompt_context() {
        let (baseline, savings) = calculate_savings(1_000_000, 100_000, 4_000, 1.0, 2.0, 3.0);
        assert!((baseline - 2.302).abs() < 1e-9);
        assert!((savings - 1.302).abs() < 1e-9);
    }

    #[test]
    fn cost_saved_percentage_handles_zero_and_negative_savings() {
        assert_eq!(cost_saved_percentage(1.0, 2.0), Some(50.0));
        assert_eq!(cost_saved_percentage(1.5, 2.0), Some(25.0));
        assert_eq!(cost_saved_percentage(2.0, 1.0), Some(-100.0));
        assert_eq!(cost_saved_percentage(1.0, 0.0), None);
    }
}
