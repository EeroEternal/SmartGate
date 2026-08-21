//! SaaS API keys: CRUD, model service grants, and per-key usage profiles.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    api::models::ApiResponse,
    auth::hash_token,
    config::AppState,
    policy::{DIFFICULTY_HIGH_THRESHOLD, DIFFICULTY_MEDIUM_THRESHOLD},
};

use super::{conflict_error, db_error, range_since, RangeQuery, SaasContext};

#[derive(Debug, Deserialize)]
pub(super) struct CreateSaasKeyRequest {
    name: String,
    #[serde(default)]
    model_service_ids: Vec<String>,
    daily_spend_limit: Option<f64>,
    rpm_limit: Option<i32>,
    concurrency_limit: Option<i32>,
}

pub(super) async fn list_api_keys(
    State(state): State<Arc<AppState>>,
    ctx: SaasContext,
) -> Result<Json<ApiResponse<Vec<Value>>>, (StatusCode, Json<ApiResponse<()>>)> {
    let rows: Vec<(String, String, String, bool, Option<i32>, Option<i32>, Option<f64>, Option<chrono::DateTime<Utc>>, chrono::DateTime<Utc>)> = sqlx::query_as(
        "SELECT id, name, key_prefix, enabled, rpm_limit, concurrency_limit, daily_spend_limit, last_used_at, created_at FROM api_keys WHERE project_id = $1 ORDER BY created_at DESC",
    ).bind(&ctx.project_id).fetch_all(&state.db).await.map_err(db_error)?;

    let mut keys = Vec::with_capacity(rows.len());
    for row in rows {
        let services: Vec<(String, String)> = sqlx::query_as(
            "SELECT vm.id, vm.name FROM api_key_model_grants g
             JOIN virtual_models vm ON vm.id = g.virtual_model_id
             WHERE g.api_key_id = $1 ORDER BY vm.name",
        )
        .bind(&row.0)
        .fetch_all(&state.db)
        .await
        .map_err(db_error)?;
        keys.push(json!({
            "id": row.0, "name": row.1, "prefix": row.2, "enabled": row.3,
            "rpm_limit": row.4, "concurrency_limit": row.5, "daily_spend_limit": row.6,
            "last_used_at": row.7, "created_at": row.8,
            "model_services": services.into_iter().map(|service| json!({"id": service.0, "name": service.1})).collect::<Vec<_>>()
        }));
    }
    Ok(Json(ApiResponse::success(keys)))
}

#[derive(Debug, sqlx::FromRow)]
struct ApiKeyProfileRow {
    timestamp: chrono::DateTime<Utc>,
    prompt_tokens: i32,
    completion_tokens: i32,
    total_tokens: i32,
    latency_ms: i32,
    status_code: Option<i32>,
    estimated_cost: f64,
    provider_type: String,
    routing_decision: Option<String>,
    metadata: Option<String>,
    usage_source: String,
    usage_confidence: String,
    pricing_source: String,
    session_id: Option<String>,
    ttft_ms: Option<i32>,
    affinity_applied: i32,
    affinity_hit: i32,
}

struct ApiKeyProfileAggregation {
    sample_count: i64,
    successful_count: i64,
    total_prompt_tokens: i64,
    total_completion_tokens: i64,
    total_tokens: i64,
    total_cost: f64,
    latencies: Vec<i32>,
    ttfts: Vec<i32>,
    difficulty_tiers: BTreeMap<String, i64>,
    difficulty_sources: BTreeMap<String, i64>,
    providers: BTreeMap<String, i64>,
    usage_sources: BTreeMap<String, i64>,
    usage_confidences: BTreeMap<String, i64>,
    pricing_sources: BTreeMap<String, i64>,
    tool_requests: i64,
    fallback_requests: i64,
    session_requests: i64,
    affinity_applied: i64,
    affinity_hits: i64,
}

fn aggregate_api_key_profile(rows: &[ApiKeyProfileRow]) -> ApiKeyProfileAggregation {
    let mut aggregation = ApiKeyProfileAggregation {
        sample_count: rows.len() as i64,
        successful_count: 0,
        total_prompt_tokens: 0,
        total_completion_tokens: 0,
        total_tokens: 0,
        total_cost: 0.0,
        latencies: Vec::with_capacity(rows.len()),
        ttfts: Vec::new(),
        difficulty_tiers: BTreeMap::new(),
        difficulty_sources: BTreeMap::new(),
        providers: BTreeMap::new(),
        usage_sources: BTreeMap::new(),
        usage_confidences: BTreeMap::new(),
        pricing_sources: BTreeMap::new(),
        tool_requests: 0,
        fallback_requests: 0,
        session_requests: 0,
        affinity_applied: 0,
        affinity_hits: 0,
    };

    for row in rows {
        if row
            .status_code
            .is_some_and(|status| (200..300).contains(&status))
        {
            aggregation.successful_count += 1;
        }
        aggregation.total_prompt_tokens += row.prompt_tokens as i64;
        aggregation.total_completion_tokens += row.completion_tokens as i64;
        aggregation.total_tokens += row.total_tokens as i64;
        aggregation.total_cost += row.estimated_cost;
        aggregation.latencies.push(row.latency_ms);
        if let Some(ttft) = row.ttft_ms {
            aggregation.ttfts.push(ttft);
        }

        let tier = profile_difficulty_tier(row.routing_decision.as_deref())
            .unwrap_or_else(|| "unknown".to_string());
        *aggregation.difficulty_tiers.entry(tier).or_default() += 1;
        *aggregation
            .difficulty_sources
            .entry(profile_difficulty_source(row.routing_decision.as_deref()))
            .or_default() += 1;
        *aggregation
            .providers
            .entry(row.provider_type.clone())
            .or_default() += 1;
        *aggregation
            .usage_sources
            .entry(row.usage_source.clone())
            .or_default() += 1;
        *aggregation
            .usage_confidences
            .entry(row.usage_confidence.clone())
            .or_default() += 1;
        *aggregation
            .pricing_sources
            .entry(row.pricing_source.clone())
            .or_default() += 1;
        aggregation.tool_requests += i64::from(profile_json_flag(
            [row.routing_decision.as_ref(), row.metadata.as_ref()],
            "has_tools",
        ));
        aggregation.fallback_requests += i64::from(profile_json_flag(
            [row.routing_decision.as_ref(), row.metadata.as_ref()],
            "fallback",
        ));
        aggregation.session_requests += i64::from(row.session_id.is_some());
        aggregation.affinity_applied += i64::from(row.affinity_applied != 0);
        aggregation.affinity_hits += i64::from(row.affinity_hit != 0);
    }

    aggregation
}

pub(super) async fn get_api_key_profile(
    State(state): State<Arc<AppState>>,
    ctx: SaasContext,
    Path(key_id): Path<String>,
    Query(query): Query<RangeQuery>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    let range = query.range.as_deref().unwrap_or("7d");
    let since = range_since(range)?;
    let key: Option<(String, String, String, bool, chrono::DateTime<Utc>)> = sqlx::query_as(
        "SELECT id, name, key_prefix, enabled, created_at
         FROM api_keys WHERE id = $1 AND project_id = $2",
    )
    .bind(&key_id)
    .bind(&ctx.project_id)
    .fetch_optional(&state.db)
    .await
    .map_err(db_error)?;
    let Some((id, name, prefix, enabled, created_at)) = key else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ApiResponse::error("API key not found")),
        ));
    };

    let base_sql = "SELECT u.timestamp, u.prompt_tokens, u.completion_tokens,
                           u.total_tokens, u.latency_ms, u.status_code,
                           u.estimated_cost,
                           COALESCE(pa.provider_type, 'unknown'),
                           u.routing_decision, u.metadata,
                           u.usage_source, u.usage_confidence, u.pricing_source,
                           u.session_id, u.ttft_ms, u.affinity_applied, u.affinity_hit
                    FROM usage_logs u
                    LEFT JOIN provider_accounts pa ON pa.id = u.provider_account_id
                    WHERE u.project_id = $1 AND u.key_id = $2";
    let rows: Vec<ApiKeyProfileRow> = if let Some(value) = since {
        sqlx::query_as(&format!("{base_sql} AND u.timestamp >= $3 ORDER BY u.timestamp ASC"))
            .bind(&ctx.project_id)
            .bind(&key_id)
            .bind(value)
            .fetch_all(&state.db)
            .await
    } else {
        sqlx::query_as(&format!("{base_sql} ORDER BY u.timestamp ASC"))
            .bind(&ctx.project_id)
            .bind(&key_id)
            .fetch_all(&state.db)
            .await
    }
    .map_err(db_error)?;

    let aggregation = aggregate_api_key_profile(&rows);
    let sample_count = aggregation.sample_count;
    let successful_count = aggregation.successful_count;
    let failed_count = sample_count - successful_count;
    let average_latency = profile_average(&aggregation.latencies);
    let average_ttft = profile_average(&aggregation.ttfts);
    let quality_evidence = unavailable_quality_evidence();

    Ok(Json(ApiResponse::success(json!({
        "key": {
            "id": id,
            "name": name,
            "prefix": prefix,
            "enabled": enabled,
            "created_at": created_at,
        },
        "range": range,
        "window_start": since,
        "last_observed_at": rows.last().map(|row| row.timestamp),
        "sample_count": sample_count,
        "confidence": profile_confidence(sample_count),
        "requests": {
            "total": sample_count,
            "successful": successful_count,
            "failed": failed_count,
            "success_rate": profile_rate(successful_count, sample_count),
        },
        "latency_ms": {
            "average": average_latency,
            "p50": profile_percentile(&aggregation.latencies, 0.50),
            "p95": profile_percentile(&aggregation.latencies, 0.95),
            "ttft_average": average_ttft,
            "ttft_p95": profile_percentile(&aggregation.ttfts, 0.95),
        },
        "tokens": {
            "prompt": aggregation.total_prompt_tokens,
            "completion": aggregation.total_completion_tokens,
            "total": aggregation.total_tokens,
            "average_per_request": profile_rate(aggregation.total_tokens, sample_count),
        },
        "cost": {
            "total": aggregation.total_cost,
            "average_per_request": profile_rate_f64(aggregation.total_cost, sample_count),
            "usage_sources": aggregation.usage_sources,
            "usage_confidences": aggregation.usage_confidences,
            "pricing_sources": aggregation.pricing_sources,
        },
        "workload": {
            "difficulty_tiers": aggregation.difficulty_tiers,
            "difficulty_sources": aggregation.difficulty_sources,
            "tool_request_rate": profile_rate(aggregation.tool_requests, sample_count),
            "fallback_rate": profile_rate(aggregation.fallback_requests, sample_count),
            "session_rate": profile_rate(aggregation.session_requests, sample_count),
            "affinity_applied_rate": profile_rate(aggregation.affinity_applied, sample_count),
            "affinity_hit_rate": profile_rate(aggregation.affinity_hits, sample_count),
        },
        "providers": aggregation.providers,
        "quality_evidence": quality_evidence,
    }))))
}

fn unavailable_quality_evidence() -> Value {
    json!({
        "status": "unavailable",
        "judge_evaluated_requests": 0,
        "judge_agreement_rate": Value::Null,
        "explicit_feedback_count": 0,
        "confidence": "none",
    })
}

fn profile_confidence(sample_count: i64) -> &'static str {
    match sample_count {
        0 => "cold_start",
        1..=19 => "low_confidence",
        20..=99 => "medium_confidence",
        _ => "high_confidence",
    }
}

fn profile_rate(numerator: i64, denominator: i64) -> Option<f64> {
    (denominator > 0).then(|| numerator as f64 / denominator as f64)
}

fn profile_rate_f64(numerator: f64, denominator: i64) -> Option<f64> {
    (denominator > 0).then(|| numerator / denominator as f64)
}

fn profile_average(values: &[i32]) -> Option<f64> {
    (!values.is_empty()).then(|| values.iter().map(|value| *value as f64).sum::<f64>() / values.len() as f64)
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

fn profile_json_flag<const N: usize>(raw_values: [Option<&String>; N], key: &str) -> bool {
    raw_values
        .into_iter()
        .filter_map(|raw| raw.and_then(|value| serde_json::from_str::<Value>(value).ok()))
        .any(|value| profile_json_value(&value, key).is_some_and(|item| {
            item.as_bool().unwrap_or_else(|| item.as_str().is_some_and(|text| matches!(text, "true" | "1")))
        }))
}

fn profile_json_value<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    match value {
        Value::Object(object) => object.get(key).or_else(|| object.values().find_map(|item| profile_json_value(item, key))),
        Value::Array(items) => items.iter().find_map(|item| profile_json_value(item, key)),
        _ => None,
    }
}

fn profile_difficulty_source(raw: Option<&str>) -> String {
    let source = raw.and_then(|raw| {
        let value = serde_json::from_str::<Value>(raw).ok()?;
        profile_json_value(&value, "difficulty_source")
            .and_then(Value::as_str)
            .map(str::to_owned)
    });
    match source.as_deref() {
        Some("judge") => "judge".to_string(),
        _ => "heuristic".to_string(),
    }
}

fn profile_difficulty_tier(raw: Option<&str>) -> Option<String> {
    let value = serde_json::from_str::<Value>(raw?).ok()?;
    if let Some(tier) = profile_json_value(&value, "difficulty_tier").and_then(Value::as_str) {
        if matches!(tier, "low" | "medium" | "high") {
            return Some(tier.to_string());
        }
    }
    let difficulty = profile_json_value(&value, "difficulty").and_then(Value::as_f64)?;
    Some(if difficulty >= DIFFICULTY_HIGH_THRESHOLD {
        "high"
    } else if difficulty >= DIFFICULTY_MEDIUM_THRESHOLD {
        "medium"
    } else {
        "low"
    }
    .to_string())
}

pub(super) async fn create_api_key(
    State(state): State<Arc<AppState>>,
    ctx: SaasContext,
    Json(input): Json<CreateSaasKeyRequest>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error("Key name is required")),
        ));
    }
    if input.model_service_ids.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error("Select at least one model service")),
        ));
    }
    let mut service_ids = input.model_service_ids.clone();
    service_ids.sort();
    service_ids.dedup();
    let service_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM virtual_models vm
         JOIN model_pools mp ON mp.id = vm.pool_id
         JOIN project_model_grants g ON g.virtual_model_id = vm.id
         WHERE mp.org_id = $1 AND g.project_id = $2 AND vm.id = ANY($3)",
    )
    .bind(&ctx.org_id)
    .bind(&ctx.project_id)
    .bind(&service_ids)
    .fetch_one(&state.db)
    .await
    .map_err(db_error)?;
    if service_count != service_ids.len() as i64 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error(
                "One or more selected model services are unavailable",
            )),
        ));
    }
    let id = Uuid::new_v4().to_string();
    let raw = format!("pk_{}", Uuid::new_v4().simple());
    let prefix = format!("{}...{}", &raw[..7], &raw[raw.len().saturating_sub(4)..]);
    let mut tx = state.db.begin().await.map_err(db_error)?;
    sqlx::query("INSERT INTO api_keys (id, project_id, name, key_hash, key_prefix, rpm_limit, concurrency_limit, daily_spend_limit) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)")
        .bind(&id).bind(&ctx.project_id).bind(&name).bind(hash_token(&raw)).bind(&prefix)
        .bind(input.rpm_limit).bind(input.concurrency_limit).bind(input.daily_spend_limit)
        .execute(&mut *tx).await.map_err(|error| {
            if error.as_database_error().and_then(|database| database.constraint()).is_some_and(|constraint| constraint.contains("idx_api_keys_project_name")) {
                conflict_error("An API key with this name already exists")
            } else {
                db_error(error)
            }
        })?;
    for service_id in &service_ids {
        sqlx::query(
            "INSERT INTO api_key_model_grants (api_key_id, virtual_model_id) VALUES ($1, $2)",
        )
        .bind(&id)
        .bind(service_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    }
    tx.commit().await.map_err(db_error)?;
    Ok(Json(ApiResponse::success(
        json!({"id": id, "name": name, "key": raw, "prefix": prefix, "model_service_ids": service_ids}),
    )))
}

pub(super) async fn update_api_key(
    State(state): State<Arc<AppState>>,
    ctx: SaasContext,
    Path(key_id): Path<String>,
    Json(input): Json<CreateSaasKeyRequest>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error("Key name is required")),
        ));
    }
    if input.model_service_ids.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error("Select at least one model service")),
        ));
    }

    let mut service_ids = input.model_service_ids.clone();
    service_ids.sort();
    service_ids.dedup();
    let service_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM virtual_models vm
         JOIN model_pools mp ON mp.id = vm.pool_id
         JOIN project_model_grants g ON g.virtual_model_id = vm.id
         WHERE mp.org_id = $1 AND g.project_id = $2 AND vm.enabled = TRUE AND vm.id = ANY($3)",
    )
    .bind(&ctx.org_id)
    .bind(&ctx.project_id)
    .bind(&service_ids)
    .fetch_one(&state.db)
    .await
    .map_err(db_error)?;
    if service_count != service_ids.len() as i64 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error(
                "One or more selected model services are unavailable",
            )),
        ));
    }

    let mut tx = state.db.begin().await.map_err(db_error)?;
    let result = sqlx::query("UPDATE api_keys SET name = $1, rpm_limit = $2, concurrency_limit = $3, daily_spend_limit = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 AND project_id = $6")
        .bind(&name)
        .bind(input.rpm_limit)
        .bind(input.concurrency_limit)
        .bind(input.daily_spend_limit)
        .bind(&key_id)
        .bind(&ctx.project_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            if error
                .as_database_error()
                .and_then(|database| database.constraint())
                .is_some_and(|constraint| constraint.contains("idx_api_keys_project_name"))
            {
                conflict_error("An API key with this name already exists")
            } else {
                db_error(error)
            }
        })?;
    if result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ApiResponse::error("API key not found")),
        ));
    }

    sqlx::query("DELETE FROM api_key_model_grants WHERE api_key_id = $1")
        .bind(&key_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    for service_id in &service_ids {
        sqlx::query(
            "INSERT INTO api_key_model_grants (api_key_id, virtual_model_id) VALUES ($1, $2)",
        )
        .bind(&key_id)
        .bind(service_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    }
    tx.commit().await.map_err(db_error)?;
    Ok(Json(ApiResponse::success(json!({
        "updated": true,
        "model_service_ids": service_ids,
    }))))
}

pub(super) async fn revoke_api_key(
    State(state): State<Arc<AppState>>,
    ctx: SaasContext,
    Path(key_id): Path<String>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    let result = sqlx::query("UPDATE api_keys SET enabled = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND project_id = $2")
        .bind(key_id)
        .bind(ctx.project_id)
        .execute(&state.db)
        .await
        .map_err(db_error)?;
    if result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ApiResponse::error("API key not found")),
        ));
    }
    Ok(Json(ApiResponse::success(json!({"revoked": true}))))
}

pub(super) async fn delete_api_key(
    State(state): State<Arc<AppState>>,
    ctx: SaasContext,
    Path(key_id): Path<String>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    let result = sqlx::query("DELETE FROM api_keys WHERE id = $1 AND project_id = $2")
        .bind(key_id)
        .bind(ctx.project_id)
        .execute(&state.db)
        .await
        .map_err(db_error)?;
    if result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ApiResponse::error("API key not found")),
        ));
    }
    Ok(Json(ApiResponse::success(json!({"deleted": true}))))
}

#[cfg(test)]
mod tests {
    use super::{
        aggregate_api_key_profile, profile_confidence, profile_difficulty_source,
        profile_difficulty_tier, profile_json_flag, profile_percentile, profile_rate,
        unavailable_quality_evidence, ApiKeyProfileRow,
    };

    #[test]
    fn api_key_profile_quality_evidence_is_explicitly_unavailable() {
        assert_eq!(
            unavailable_quality_evidence(),
            serde_json::json!({
                "status": "unavailable",
                "judge_evaluated_requests": 0,
                "judge_agreement_rate": serde_json::Value::Null,
                "explicit_feedback_count": 0,
                "confidence": "none",
            })
        );
    }

    #[test]
    fn api_key_profile_confidence_uses_sample_count() {
        assert_eq!(profile_confidence(0), "cold_start");
        assert_eq!(profile_confidence(1), "low_confidence");
        assert_eq!(profile_confidence(19), "low_confidence");
        assert_eq!(profile_confidence(20), "medium_confidence");
        assert_eq!(profile_confidence(100), "high_confidence");
    }

    #[test]
    fn api_key_profile_sources_default_to_heuristic_and_accept_judge() {
        assert_eq!(profile_difficulty_source(None), "heuristic");
        assert_eq!(
            profile_difficulty_source(Some(r#"{"difficulty_source":"judge"}"#)),
            "judge"
        );
        assert_eq!(
            profile_difficulty_source(Some(r#"{"difficulty_source":"unknown"}"#)),
            "heuristic"
        );
    }

    fn profile_row(
        status_code: Option<i32>,
        routing_decision: Option<&str>,
        metadata: Option<&str>,
        session_id: Option<&str>,
        ttft_ms: Option<i32>,
        affinity_applied: i32,
        affinity_hit: i32,
    ) -> ApiKeyProfileRow {
        ApiKeyProfileRow {
            timestamp: chrono::Utc::now(),
            prompt_tokens: 100,
            completion_tokens: 25,
            total_tokens: 125,
            latency_ms: 400,
            status_code,
            estimated_cost: 0.125,
            provider_type: "openai".to_string(),
            routing_decision: routing_decision.map(str::to_string),
            metadata: metadata.map(str::to_string),
            usage_source: "provider".to_string(),
            usage_confidence: "high".to_string(),
            pricing_source: "configured".to_string(),
            session_id: session_id.map(str::to_string),
            ttft_ms,
            affinity_applied,
            affinity_hit,
        }
    }

    #[test]
    fn api_key_profile_aggregation_is_empty_for_no_samples() {
        let aggregation = aggregate_api_key_profile(&[]);
        assert_eq!(aggregation.sample_count, 0);
        assert_eq!(aggregation.successful_count, 0);
        assert_eq!(aggregation.total_tokens, 0);
        assert!(aggregation.latencies.is_empty());
        assert!(aggregation.providers.is_empty());
        assert!(aggregation.difficulty_tiers.is_empty());
        assert!(aggregation.difficulty_sources.is_empty());
    }

    #[test]
    fn api_key_profile_aggregation_covers_full_observation_contract() {
        let rows = vec![
            profile_row(
                Some(200),
                Some(r#"{"difficulty_tier":"medium","difficulty_source":"judge","has_tools":true,"fallback":true}"#),
                None,
                Some("session-1"),
                Some(100),
                1,
                1,
            ),
            profile_row(
                Some(503),
                Some(r#"{"difficulty":0.2,"difficulty_source":"heuristic"}"#),
                Some(r#"{"has_tools":true}"#),
                None,
                None,
                0,
                0,
            ),
        ];
        let aggregation = aggregate_api_key_profile(&rows);

        assert_eq!(aggregation.sample_count, 2);
        assert_eq!(aggregation.successful_count, 1);
        assert_eq!(aggregation.total_prompt_tokens, 200);
        assert_eq!(aggregation.total_completion_tokens, 50);
        assert_eq!(aggregation.total_tokens, 250);
        assert!((aggregation.total_cost - 0.25).abs() < f64::EPSILON);
        assert_eq!(aggregation.latencies, vec![400, 400]);
        assert_eq!(aggregation.ttfts, vec![100]);
        assert_eq!(aggregation.difficulty_tiers.get("low"), Some(&1));
        assert_eq!(aggregation.difficulty_tiers.get("medium"), Some(&1));
        assert_eq!(aggregation.difficulty_sources.get("heuristic"), Some(&1));
        assert_eq!(aggregation.difficulty_sources.get("judge"), Some(&1));
        assert_eq!(aggregation.providers.get("openai"), Some(&2));
        assert_eq!(aggregation.usage_sources.get("provider"), Some(&2));
        assert_eq!(aggregation.usage_confidences.get("high"), Some(&2));
        assert_eq!(aggregation.pricing_sources.get("configured"), Some(&2));
        assert_eq!(aggregation.tool_requests, 2);
        assert_eq!(aggregation.fallback_requests, 1);
        assert_eq!(aggregation.session_requests, 1);
        assert_eq!(aggregation.affinity_applied, 1);
        assert_eq!(aggregation.affinity_hits, 1);
    }

    #[test]
    fn api_key_profile_helpers_are_null_aware_and_ignore_raw_prompt_fields() {
        assert_eq!(profile_rate(0, 0), None);
        assert_eq!(profile_rate(1, 4), Some(0.25));
        assert_eq!(profile_percentile(&[400, 100, 200, 300], 0.95), Some(400.0));

        let decision = serde_json::json!({
            "difficulty": 0.6,
            "has_tools": true,
            "nested": {"fallback": "true"},
            "prompt_preview": "must not be returned"
        })
        .to_string();
        assert_eq!(profile_difficulty_tier(Some(&decision)).as_deref(), Some("high"));
        assert!(profile_json_flag([Some(&decision)], "has_tools"));
        assert!(profile_json_flag([Some(&decision)], "fallback"));
        assert!(!profile_json_flag([Some(&decision)], "prompt_preview"));
    }
}
