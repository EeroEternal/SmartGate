//! Model service endpoint CRUD: add, update, and delete pool endpoints.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde_json::{json, Value};
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    api::models::ApiResponse,
    config::AppState,
    pricing::effective_capability_score,
    saas::{db_error, sync, SaasContext},
};

use super::{
    clean_base_url, AddEndpointsPayload, ModelEndpointRequest, UpdateModelEndpointRequest,
};

pub(crate) async fn add_model_service_endpoint(
    State(state): State<Arc<AppState>>,
    ctx: SaasContext,
    Path(model_id): Path<String>,
    Json(payload): Json<AddEndpointsPayload>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    let endpoints_to_add: Vec<ModelEndpointRequest> = match payload {
        AddEndpointsPayload::Single(single) => vec![*single],
        AddEndpointsPayload::Batch { endpoints } => endpoints,
        AddEndpointsPayload::List(list) => list,
    };

    if endpoints_to_add.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error(
                "At least one model endpoint is required",
            )),
        ));
    }

    for ep in &endpoints_to_add {
        let upstream_model_id = ep.upstream_model_id.trim();
        if upstream_model_id.is_empty() {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ApiResponse::error("Upstream model ID is required")),
            ));
        }
        if ep.account_id.is_none() {
            let ptype = ep.provider_type.as_deref().unwrap_or("custom").trim();
            let base_url = ep.base_url.as_deref().unwrap_or("").trim();
            let api_key = ep.api_key.as_deref().unwrap_or("").trim();
            if ptype.is_empty() || base_url.is_empty() || api_key.is_empty() {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(ApiResponse::error(
                        "Provider type, URL, API key, and model are required for new provider accounts",
                    )),
                ));
            }
            let protocol = ep.protocol.as_deref().unwrap_or("openai");
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

    let pool: Option<(String, i64)> = sqlx::query_as(
        "SELECT mp.id, COUNT(mpe.endpoint_id)
         FROM virtual_models vm
         JOIN model_pools mp ON mp.id = vm.pool_id
         LEFT JOIN model_pool_endpoints mpe ON mpe.pool_id = mp.id
         WHERE vm.id = $1 AND mp.org_id = $2 AND EXISTS (
             SELECT 1 FROM project_model_grants g
             WHERE g.virtual_model_id = vm.id AND g.project_id = $3
         )
         GROUP BY mp.id",
    )
    .bind(&model_id)
    .bind(&ctx.org_id)
    .bind(&ctx.project_id)
    .fetch_optional(&state.db)
    .await
    .map_err(db_error)?;

    let Some((pool_id, initial_count)) = pool else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ApiResponse::error("Model service not found")),
        ));
    };

    let mut tx = state.db.begin().await.map_err(db_error)?;
    let mut added_ids = Vec::with_capacity(endpoints_to_add.len());
    let mut current_count = initial_count;

    for endpoint in endpoints_to_add {
        let (provider_id, _ptype) = if let Some(ref aid) = endpoint.account_id {
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
            let ptype = endpoint
                .provider_type
                .as_deref()
                .unwrap_or("custom")
                .trim()
                .to_string();
            let protocol = endpoint.protocol.as_deref().unwrap_or("openai");
            let base_url = endpoint.base_url.as_deref().unwrap_or("");
            let api_key = endpoint.api_key.as_deref().unwrap_or("");
            let pid = Uuid::new_v4().to_string();
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

        current_count += 1;
        let endpoint_id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO endpoints (id, account_id, name, upstream_model_id, input_price_per_1m, output_price_per_1m, capability_score, supports_tools, context_length) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)")
            .bind(&endpoint_id)
            .bind(&provider_id)
            .bind(format!("model-service-{}", current_count))
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

        added_ids.push(endpoint_id);
    }

    tx.commit().await.map_err(db_error)?;
    sync(&state).await;

    Ok(Json(ApiResponse::success(json!({
        "added_count": added_ids.len(),
        "endpoint_ids": added_ids,
        "endpoint_count": current_count,
    }))))
}

pub(crate) async fn update_model_service_endpoint(
    State(state): State<Arc<AppState>>,
    ctx: SaasContext,
    Path((model_id, endpoint_id)): Path<(String, String)>,
    Json(input): Json<UpdateModelEndpointRequest>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    let provider_name = input.provider_name.trim();
    let provider_type = input.provider_type.trim();
    let protocol = input.protocol.trim().to_ascii_lowercase();
    let base_url = input.base_url.trim();
    let model = input.upstream_model_id.trim();
    if provider_name.is_empty()
        || provider_type.is_empty()
        || base_url.is_empty()
        || model.is_empty()
    {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error(
                "Provider name, provider ID, URL, and model are required",
            )),
        ));
    }
    if !matches!(protocol.as_str(), "openai" | "anthropic") {
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
    let account: Option<(String,)> = sqlx::query_as(
        "SELECT e.account_id FROM endpoints e
         JOIN model_pool_endpoints mpe ON mpe.endpoint_id = e.id
         JOIN model_pools mp ON mp.id = mpe.pool_id
         JOIN virtual_models vm ON vm.pool_id = mp.id
         WHERE vm.id = $1 AND e.id = $2 AND mp.org_id = $3 AND EXISTS (
             SELECT 1 FROM project_model_grants g
             WHERE g.virtual_model_id = vm.id AND g.project_id = $4
         )",
    )
    .bind(&model_id)
    .bind(&endpoint_id)
    .bind(&ctx.org_id)
    .bind(&ctx.project_id)
    .fetch_optional(&state.db)
    .await
    .map_err(db_error)?;
    let Some((account_id,)) = account else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ApiResponse::error("Model endpoint not found")),
        ));
    };
    let cleaned_base_url = clean_base_url(base_url);
    let mut tx = state.db.begin().await.map_err(db_error)?;
    sqlx::query("UPDATE provider_accounts SET name = $1, provider_type = $2, protocol = $3, base_url = $4, api_key = COALESCE($5, api_key), updated_at = CURRENT_TIMESTAMP WHERE id = $6")
        .bind(provider_name).bind(provider_type).bind(&protocol).bind(&cleaned_base_url)
        .bind(input.api_key.as_deref().filter(|key| !key.trim().is_empty())).bind(&account_id)
        .execute(&mut *tx).await.map_err(db_error)?;
    sqlx::query("UPDATE endpoints SET upstream_model_id = $1, input_price_per_1m = $2, output_price_per_1m = $3, capability_score = $4, supports_tools = COALESCE($5, supports_tools), context_length = $6, updated_at = CURRENT_TIMESTAMP WHERE id = $7")
        // Omitting a price clears it to unpriced (NULL); an explicit 0 stays a free model.
        .bind(model).bind(input.input_price_per_1m).bind(input.output_price_per_1m)
        .bind(effective_capability_score(model, input.capability_score.unwrap_or(0.0)))
        .bind(input.supports_tools.map(|value| if value { 1 } else { 0 })).bind(input.context_length).bind(&endpoint_id)
        .execute(&mut *tx).await.map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    sync(&state).await;
    Ok(Json(ApiResponse::success(
        json!({"id": endpoint_id, "updated": true}),
    )))
}

pub(crate) async fn delete_model_service_endpoint(
    State(state): State<Arc<AppState>>,
    ctx: SaasContext,
    Path((model_id, endpoint_id)): Path<(String, String)>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    let account_id: Option<(String,)> = sqlx::query_as(
        "SELECT e.account_id
         FROM endpoints e
         JOIN model_pool_endpoints mpe ON mpe.endpoint_id = e.id
         JOIN virtual_models vm ON vm.pool_id = mpe.pool_id
         JOIN model_pools mp ON mp.id = vm.pool_id
         WHERE vm.id = $1 AND e.id = $2 AND mp.org_id = $3 AND EXISTS (
             SELECT 1 FROM project_model_grants g
             WHERE g.virtual_model_id = vm.id AND g.project_id = $4
         )",
    )
    .bind(&model_id)
    .bind(&endpoint_id)
    .bind(&ctx.org_id)
    .bind(&ctx.project_id)
    .fetch_optional(&state.db)
    .await
    .map_err(db_error)?;
    let Some((account_id,)) = account_id else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ApiResponse::error("Model endpoint not found")),
        ));
    };
    let mut tx = state.db.begin().await.map_err(db_error)?;
    sqlx::query("DELETE FROM model_pool_endpoints WHERE endpoint_id = $1")
        .bind(&endpoint_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    sqlx::query("DELETE FROM endpoints WHERE id = $1")
        .bind(&endpoint_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    sqlx::query("DELETE FROM provider_accounts WHERE id = $1")
        .bind(&account_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    sync(&state).await;
    Ok(Json(ApiResponse::success(json!({"deleted": true}))))
}
