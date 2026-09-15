//! Model service CRUD: create, read, update, list, and delete virtual models.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use chrono::Utc;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    api::models::ApiResponse,
    config::AppState,
    pricing::effective_capability_score,
    saas::{conflict_error, db_error, saas_strategy, sync, SaasContext},
};

use super::{
    clean_base_url, ModelEndpointRequest, ModelServiceDetailRow, ModelServiceListRow,
    ModelServiceRequest, ModelServiceSummary, ServiceEndpointRow, UpdateModelServiceRequest,
};

pub(crate) async fn create_model_service(
    State(state): State<Arc<AppState>>,
    ctx: SaasContext,
    Json(input): Json<ModelServiceRequest>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    if input.name.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error("Service name is required")),
        ));
    }

    let endpoints = if !input.endpoints.is_empty() {
        input.endpoints
    } else {
        match (
            input.provider_type,
            input.base_url,
            input.api_key,
            input.upstream_model_id,
        ) {
            (Some(provider_type), Some(base_url), Some(api_key), Some(upstream_model_id)) => {
                vec![ModelEndpointRequest {
                    account_id: None,
                    provider_type: Some(provider_type),
                    provider_name: None,
                    protocol: None,
                    base_url: Some(base_url),
                    api_key: Some(api_key),
                    upstream_model_id,
                    input_price_per_1m: input.input_price_per_1m,
                    output_price_per_1m: input.output_price_per_1m,
                    capability_score: input.capability_score,
                    supports_tools: input.supports_tools,
                    context_length: input.context_length,
                }]
            }
            _ => Vec::new(),
        }
    };

    for endpoint in &endpoints {
        if endpoint.upstream_model_id.trim().is_empty() {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ApiResponse::error(
                    "Every upstream endpoint needs a model ID",
                )),
            ));
        }
        if endpoint.account_id.is_none() {
            let ptype = endpoint.provider_type.as_deref().unwrap_or("").trim();
            let base_url = endpoint.base_url.as_deref().unwrap_or("").trim();
            let api_key = endpoint.api_key.as_deref().unwrap_or("").trim();
            if ptype.is_empty() || base_url.is_empty() || api_key.is_empty() {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(ApiResponse::error(
                        "Every upstream endpoint needs a provider, URL, API key, and model",
                    )),
                ));
            }
            let protocol = endpoint.protocol.as_deref().unwrap_or("openai");
            if !matches!(protocol, "openai" | "anthropic") {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(ApiResponse::error("Protocol must be OpenAI or Anthropic")),
                ));
            }
            if !base_url.starts_with("https://") && !base_url.starts_with("http://127.0.0.1") {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(ApiResponse::error("Provider URL must use HTTPS")),
                ));
            }
        }
    }

    let service_name = input.name.trim().to_string();
    if service_name.len() > 120 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error(
                "Model service name must be 120 characters or fewer",
            )),
        ));
    }
    let pool_id = Uuid::new_v4().to_string();
    let model_id = Uuid::new_v4().to_string();
    // The client-facing model is always the model service name.
    let public_model = service_name.clone();
    let strategy = saas_strategy(
        input
            .strategy
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("cost_aware"),
    )?;
    let mut tx = state.db.begin().await.map_err(db_error)?;
    let mut provider_types = Vec::with_capacity(endpoints.len());

    sqlx::query("INSERT INTO model_pools (id, org_id, name, strategy) VALUES ($1, $2, $3, $4)")
        .bind(&pool_id)
        .bind(&ctx.org_id)
        .bind(&service_name)
        .bind(&strategy)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;

    for (index, endpoint) in endpoints.iter().enumerate() {
        let (provider_id, provider_type) = if let Some(ref aid) = endpoint.account_id {
            let account: Option<(String, String)> = sqlx::query_as(
                "SELECT id, provider_type FROM provider_accounts WHERE id = $1 AND org_id = $2",
            )
            .bind(aid)
            .bind(&ctx.org_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_error)?;

            let Some((pid, ptype)) = account else {
                return Err((
                    StatusCode::NOT_FOUND,
                    Json(ApiResponse::error("Selected provider account not found")),
                ));
            };
            (pid, ptype)
        } else {
            let pid = Uuid::new_v4().to_string();
            let ptype = endpoint
                .provider_type
                .as_deref()
                .unwrap_or("custom")
                .trim()
                .to_string();
            let protocol = endpoint.protocol.as_deref().unwrap_or("openai");
            let base_url = endpoint.base_url.as_deref().unwrap_or("");
            let api_key = endpoint.api_key.as_deref().unwrap_or("");
            sqlx::query("INSERT INTO provider_accounts (id, org_id, name, provider_type, protocol, base_url, api_key) VALUES ($1, $2, $3, $4, $5, $6, $7)")
                .bind(&pid)
                .bind(&ctx.org_id)
                .bind(endpoint.provider_name.clone().unwrap_or_else(|| ptype.clone()))
                .bind(&ptype)
                .bind(protocol)
                .bind(clean_base_url(base_url))
                .bind(api_key)
                .execute(&mut *tx)
                .await
                .map_err(db_error)?;
            (pid, ptype)
        };

        provider_types.push(provider_type);
        let endpoint_id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO endpoints (id, account_id, name, upstream_model_id, input_price_per_1m, output_price_per_1m, capability_score, supports_tools, context_length) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)")
            .bind(&endpoint_id)
            .bind(&provider_id)
            .bind(format!("{}-{}", service_name, index + 1))
            .bind(&endpoint.upstream_model_id)
            .bind(endpoint.input_price_per_1m)
            .bind(endpoint.output_price_per_1m)
            .bind(effective_capability_score(
                &endpoint.upstream_model_id,
                endpoint.capability_score.unwrap_or(0.0),
            ))
            .bind(endpoint.supports_tools.map(|value| if value { 1 } else { 0 }))
            .bind(endpoint.context_length)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        sqlx::query("INSERT INTO model_pool_endpoints (pool_id, endpoint_id, priority, weight) VALUES ($1, $2, 1, 1)")
            .bind(&pool_id)
            .bind(&endpoint_id)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
    }

    sqlx::query("INSERT INTO virtual_models (id, pool_id, name) VALUES ($1, $2, $3)")
        .bind(&model_id)
        .bind(&pool_id)
        .bind(&public_model)
        .execute(&mut *tx)
        .await
        .map_err(|_| conflict_error("Model name is already in use"))?;
    sqlx::query("INSERT INTO project_model_grants (project_id, virtual_model_id) VALUES ($1, $2)")
        .bind(&ctx.project_id)
        .bind(&model_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    sync(&state).await;
    Ok(Json(ApiResponse::success(json!({
        "id": model_id,
        "name": service_name,
        "model": public_model,
        "provider_type": if provider_types.len() > 1 { "mixed".to_string() } else { provider_types.first().cloned().unwrap_or_else(|| "not_configured".to_string()) },
        "provider_types": provider_types,
        "endpoint_count": endpoints.len(),
        "strategy": strategy,
        "status": if endpoints.is_empty() { "draft" } else { "active" }
    }))))
}

pub(crate) async fn get_model_service(
    State(state): State<Arc<AppState>>,
    ctx: SaasContext,
    Path(model_id): Path<String>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    let service: Option<ModelServiceDetailRow> = sqlx::query_as(
            "SELECT vm.id, vm.name, mp.name, mp.strategy, mp.judge_enabled, mp.judge_endpoint_id, mp.id,
                    mp.shadow_enabled, mp.shadow_virtual_model_id, mp.shadow_sample_rate
         FROM virtual_models vm
         JOIN model_pools mp ON mp.id = vm.pool_id
         WHERE vm.id = $1 AND mp.org_id = $2 AND EXISTS (
             SELECT 1 FROM project_model_grants g
             WHERE g.virtual_model_id = vm.id AND g.project_id = $3
         )",
        )
        .bind(&model_id)
        .bind(&ctx.org_id)
        .bind(&ctx.project_id)
        .fetch_optional(&state.db)
        .await
        .map_err(db_error)?;
    let Some((
        id,
        _legacy_model,
        name,
        strategy,
        judge_enabled,
        judge_endpoint_id,
        pool_id,
        shadow_enabled,
        shadow_virtual_model_id,
        shadow_sample_rate,
    )) = service
    else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ApiResponse::error("Model service not found")),
        ));
    };
    let endpoints: Vec<ServiceEndpointRow> = sqlx::query_as(
        "SELECT e.id, pa.id AS provider_id, CASE WHEN pa.name LIKE 'saas-%' THEN pa.provider_type ELSE pa.name END AS provider_name,
                    pa.provider_type, pa.protocol, e.upstream_model_id, pa.base_url,
                    e.input_price_per_1m, e.output_price_per_1m, e.capability_score,
                    e.context_length, e.enabled, e.health_status, e.supports_tools
             FROM model_pool_endpoints mpe
             JOIN model_pools mp ON mp.id = mpe.pool_id
             JOIN endpoints e ON e.id = mpe.endpoint_id
             JOIN provider_accounts pa ON pa.id = e.account_id
             WHERE mp.id = (SELECT pool_id FROM virtual_models WHERE id = $1)
             ORDER BY e.created_at ASC",
    )
    .bind(&model_id)
    .fetch_all(&state.db)
    .await
    .map_err(db_error)?;
    let provider_types = endpoints
        .iter()
        .map(|endpoint| endpoint.provider_type.clone())
        .collect::<Vec<_>>();
    // Report the capability the router actually uses, not the raw column, so the
    // UI and routing decisions cannot disagree.
    let effective_capabilities = crate::pricing::resolve_pool_capabilities(
        &endpoints
            .iter()
            .map(|endpoint| {
                (
                    endpoint.upstream_model_id.clone(),
                    crate::pricing::effective_capability_score(
                        &endpoint.upstream_model_id,
                        endpoint.capability_score,
                    ),
                )
            })
            .collect::<Vec<_>>(),
    );
    // Ask the router itself which endpoint a hard request reaches right now, so the
    // badge also reflects health, cooldown and tool-support exclusions rather than
    // just the highest score.
    let hard_request_pick = state
        .feedback
        .explain(
            &pool_id,
            crate::policy::RouteHint {
                input_tokens: crate::routing::COST_RANK_INPUT_TOKENS,
                output_tokens: crate::routing::COST_RANK_OUTPUT_TOKENS,
                has_tools: true,
                difficulty: 1.0,
                downshift: false,
                pool_id: pool_id.clone(),
                affinity_enabled: false,
                sticky_endpoint_id: None,
            },
        )
        .into_iter()
        .find(|candidate| {
            candidate
                .get("excluded")
                .and_then(|value| value.as_bool())
                .map(|excluded| !excluded)
                .unwrap_or(false)
        })
        .and_then(|candidate| {
            candidate
                .get("endpoint_id")
                .and_then(|value| value.as_str())
                .map(str::to_string)
        })
        // A service whose pool has not been synced yet has no routing state.
        .or_else(|| {
            endpoints
                .iter()
                .zip(effective_capabilities.iter())
                .filter(|(endpoint, _)| endpoint.enabled)
                .max_by(|(left, left_capability), (right, right_capability)| {
                    left_capability.total_cmp(right_capability).then_with(|| {
                        crate::pricing::default_capability_score(&left.upstream_model_id, None)
                            .total_cmp(&crate::pricing::default_capability_score(
                                &right.upstream_model_id,
                                None,
                            ))
                    })
                })
                .map(|(endpoint, _)| endpoint.id.clone())
        });
    let endpoint_values = endpoints
        .into_iter()
        .zip(effective_capabilities)
        .map(|(endpoint, effective_capability)| {
            // Live routing health beats the persisted column: a repeatedly failing
            // endpoint is the usual reason a strong model never appears in logs.
            let runtime = state.metrics.get(&endpoint.id);
            let health_status = runtime
                .as_ref()
                .map(|metric| metric.health_status.clone())
                .unwrap_or_else(|| endpoint.health_status.clone());
            let cooling_down = runtime
                .as_ref()
                .and_then(|metric| metric.cooldown_until)
                .is_some_and(|until| until > Utc::now());
            let observed_requests = runtime
                .as_ref()
                .map(|metric| metric.total_requests)
                .unwrap_or(0);
            json!({
                "id": endpoint.id,
                "provider_id": endpoint.provider_id,
                "provider_name": endpoint.provider_name,
                "provider_type": endpoint.provider_type,
                "protocol": endpoint.protocol,
                "model": endpoint.upstream_model_id,
                "base_url": endpoint.base_url,
                "input_price_per_1m": endpoint.input_price_per_1m,
                "output_price_per_1m": endpoint.output_price_per_1m,
                "capability_score": effective_capability,
                "configured_capability_score": endpoint.capability_score,
                "context_length": endpoint.context_length,
                "enabled": endpoint.enabled,
                "supports_tools": endpoint.supports_tools.map(|value| value != 0),
                "health_status": health_status,
                "cooling_down": cooling_down,
                "total_requests": observed_requests,
                "total_errors": runtime.as_ref().map(|metric| metric.total_errors).unwrap_or(0),
                // Without observed traffic the status is only what a previous process
                // recorded, so the UI must not present it as current.
                "health_observed": observed_requests > 0,
                // Capability-first routing sends hard requests here when true.
                "preferred_for_hard_requests": hard_request_pick.as_deref() == Some(endpoint.id.as_str()),
                "model_dna": crate::pricing::derive_model_dna(&endpoint.upstream_model_id, effective_capability, endpoint.supports_tools.map(|value| value != 0)),
            })
        })
        .collect::<Vec<_>>();
    let endpoint_count = endpoint_values.len();
    Ok(Json(ApiResponse::success(json!({
        "id": id,
        "name": name,
        "model": name,
        "strategy": strategy,
        "provider_type": if provider_types.len() > 1 { "mixed" } else { provider_types.first().map(String::as_str).unwrap_or("not_configured") },
        "provider_types": provider_types,
        "endpoint_count": endpoint_count,
        "endpoints": endpoint_values,
        "status": if endpoint_count == 0 { "draft" } else { "active" },
        "judge_enabled": judge_enabled != 0,
        "judge_endpoint_id": judge_endpoint_id,
        "shadow_enabled": shadow_enabled != 0,
        "shadow_virtual_model_id": shadow_virtual_model_id,
        "shadow_sample_rate": shadow_sample_rate,
    }))))
}

pub(crate) async fn update_model_service(
    State(state): State<Arc<AppState>>,
    ctx: SaasContext,
    Path(model_id): Path<String>,
    Json(input): Json<UpdateModelServiceRequest>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    let pool: Option<(String, String)> = sqlx::query_as(
        "SELECT mp.id, mp.strategy FROM virtual_models vm
         JOIN model_pools mp ON mp.id = vm.pool_id
         WHERE vm.id = $1 AND mp.org_id = $2 AND EXISTS (
             SELECT 1 FROM project_model_grants g
             WHERE g.virtual_model_id = vm.id AND g.project_id = $3
         )",
    )
    .bind(&model_id)
    .bind(&ctx.org_id)
    .bind(&ctx.project_id)
    .fetch_optional(&state.db)
    .await
    .map_err(db_error)?;
    let Some((pool_id, existing_strategy)) = pool else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ApiResponse::error("Model service not found")),
        ));
    };

    let strategy = match input.strategy.as_deref() {
        Some(s) if !s.trim().is_empty() => saas_strategy(s)?,
        _ => existing_strategy,
    };

    let judge_enabled = input.judge_enabled.map(|v| if v { 1 } else { 0 });
    let shadow_enabled = input.shadow_enabled.map(|v| if v { 1 } else { 0 });
    let shadow_sample_rate = input.shadow_sample_rate.map(|v| v.clamp(0.0, 1.0));

    let mut tx = state.db.begin().await.map_err(db_error)?;

    if let Some(ref raw_name) = input.name {
        let trimmed_name = raw_name.trim();
        if trimmed_name.is_empty() {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ApiResponse::error("Model service name cannot be empty")),
            ));
        }
        if trimmed_name.len() > 120 {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ApiResponse::error(
                    "Model service name must be 120 characters or fewer",
                )),
            ));
        }
        sqlx::query("UPDATE virtual_models SET name = $1 WHERE id = $2")
            .bind(trimmed_name)
            .bind(&model_id)
            .execute(&mut *tx)
            .await
            .map_err(|_| conflict_error("Model name is already in use"))?;

        sqlx::query("UPDATE model_pools SET name = $1 WHERE id = $2")
            .bind(trimmed_name)
            .bind(&pool_id)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
    }

    sqlx::query(
        "UPDATE model_pools SET strategy = $1,
            judge_enabled = COALESCE($2, judge_enabled),
            judge_endpoint_id = CASE WHEN $2 IS NOT NULL THEN $3 ELSE judge_endpoint_id END,
            shadow_enabled = COALESCE($7, shadow_enabled),
            shadow_virtual_model_id = CASE WHEN $7 IS NOT NULL THEN $8 ELSE shadow_virtual_model_id END,
            shadow_sample_rate = COALESCE($9, shadow_sample_rate),
            updated_at = CURRENT_TIMESTAMP WHERE id = $4",
    )
    .bind(&strategy)
    .bind(judge_enabled)
    .bind(input.judge_endpoint_id.as_deref().filter(|s| !s.trim().is_empty()))
    .bind(&pool_id)
    .bind(judge_enabled)
    .bind(input.judge_endpoint_id.as_deref().filter(|s| !s.trim().is_empty()))
    .bind(shadow_enabled)
    .bind(input.shadow_virtual_model_id.as_deref().filter(|s| !s.trim().is_empty()))
    .bind(shadow_sample_rate)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;

    tx.commit().await.map_err(db_error)?;
    sync(&state).await;

    Ok(Json(ApiResponse::success(json!({
        "id": model_id,
        "name": input.name.as_deref().map(str::trim),
        "strategy": strategy,
        "shadow_enabled": input.shadow_enabled.unwrap_or(false),
        "shadow_sample_rate": input.shadow_sample_rate.unwrap_or(0.0),
        "updated": true
    }))))
}

pub(crate) async fn list_model_services(
    State(state): State<Arc<AppState>>,
    ctx: SaasContext,
) -> Result<Json<ApiResponse<Vec<Value>>>, (StatusCode, Json<ApiResponse<()>>)> {
    let rows: Vec<ModelServiceListRow> = sqlx::query_as(
        "SELECT vm.id, vm.name, mp.name, mp.strategy, pa.provider_type, e.upstream_model_id,
                e.health_status, e.name
         FROM virtual_models vm
         JOIN model_pools mp ON mp.id = vm.pool_id
         LEFT JOIN model_pool_endpoints mpe ON mpe.pool_id = mp.id
         LEFT JOIN endpoints e ON e.id = mpe.endpoint_id
         LEFT JOIN provider_accounts pa ON pa.id = e.account_id
         WHERE mp.org_id = $1 AND EXISTS (
             SELECT 1 FROM project_model_grants g WHERE g.virtual_model_id = vm.id AND g.project_id = $2
         ) ORDER BY vm.created_at DESC, e.created_at ASC",
    )
    .bind(&ctx.org_id)
    .bind(&ctx.project_id)
    .fetch_all(&state.db)
    .await
    .map_err(db_error)?;

    let mut services: Vec<ModelServiceSummary> = Vec::new();
    let mut indexes = HashMap::new();
    for row in rows {
        let index = if let Some(index) = indexes.get(&row.0) {
            *index
        } else {
            let index = services.len();
            indexes.insert(row.0.clone(), index);
            services.push((
                row.0.clone(),
                row.1.clone(),
                row.2.clone(),
                row.3.clone(),
                Vec::new(),
                Vec::new(),
                Vec::new(),
            ));
            index
        };
        let service = &mut services[index];
        if let Some(provider_type) = row.4 {
            if !service.4.contains(&provider_type) {
                service.4.push(provider_type);
            }
        }
        if let Some(model) = row.5 {
            service.5.push(model);
        }
        if let Some(status) = row.6 {
            service.6.push(status);
        }
    }

    Ok(Json(ApiResponse::success(
        services
            .into_iter()
            .map(|service| {
                let health_status = if service.6.is_empty() {
                    "draft"
                } else if service.6.iter().all(|status| status == "healthy") {
                    "healthy"
                } else if service.6.iter().any(|status| status == "unavailable") {
                    "unavailable"
                } else {
                    "degraded"
                };
                json!({
                    "id": service.0,
                    "name": service.2,
                    "model": service.2,
                    "provider_type": if service.4.len() > 1 { "mixed" } else { service.4.first().map(String::as_str).unwrap_or("custom") },
                    "provider_types": service.4,
                    "upstream_models": service.5,
                    "endpoint_count": service.6.len(),
                    "strategy": service.3,
                    "health_status": health_status
                })
            })
            .collect(),
    )))
}

pub(crate) async fn delete_model_service(
    State(state): State<Arc<AppState>>,
    ctx: SaasContext,
    Path(model_id): Path<String>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    let pool_id: Option<(String,)> = sqlx::query_as(
        "SELECT mp.id FROM virtual_models vm JOIN model_pools mp ON mp.id = vm.pool_id
         WHERE vm.id = $1 AND mp.org_id = $2 AND EXISTS (
             SELECT 1 FROM project_model_grants g WHERE g.virtual_model_id = vm.id AND g.project_id = $3
         )",
    ).bind(&model_id).bind(&ctx.org_id).bind(&ctx.project_id).fetch_optional(&state.db).await.map_err(db_error)?;
    let Some((pool_id,)) = pool_id else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ApiResponse::error("Model service not found")),
        ));
    };
    let mut tx = state.db.begin().await.map_err(db_error)?;
    let endpoints: Vec<(String, String)> = sqlx::query_as("SELECT endpoint_id, e.account_id FROM model_pool_endpoints mpe JOIN endpoints e ON e.id = mpe.endpoint_id WHERE mpe.pool_id = $1")
        .bind(&pool_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(db_error)?;
    sqlx::query("DELETE FROM project_model_grants WHERE virtual_model_id = $1")
        .bind(&model_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    sqlx::query("DELETE FROM virtual_models WHERE id = $1")
        .bind(&model_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    sqlx::query("DELETE FROM model_pool_endpoints WHERE pool_id = $1")
        .bind(&pool_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    sqlx::query("DELETE FROM model_pools WHERE id = $1")
        .bind(&pool_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    for (endpoint_id, account_id) in endpoints {
        sqlx::query("DELETE FROM endpoints WHERE id = $1")
            .bind(endpoint_id)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        // A provider account may be shared by endpoints in other model services. Only
        // remove it once no endpoint still references it, otherwise the account deletion
        // would cascade and destroy those unrelated endpoints.
        sqlx::query(
            "DELETE FROM provider_accounts WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM endpoints WHERE account_id = $1)",
        )
        .bind(account_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    }
    tx.commit().await.map_err(db_error)?;
    sync(&state).await;
    Ok(Json(ApiResponse::success(json!({"deleted": true}))))
}
