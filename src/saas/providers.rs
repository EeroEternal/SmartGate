use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    api::models::ApiResponse,
    config::AppState,
    saas::{db_error, SaasContext},
};

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct SaasProviderItem {
    pub id: String,
    pub name: String,
    pub provider_type: String,
    pub protocol: String,
    pub base_url: String,
    pub status: String,
    pub endpoint_count: i64,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateSaasProviderRequest {
    pub name: String,
    pub provider_type: String,
    pub protocol: Option<String>,
    pub base_url: String,
    pub api_key: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSaasProviderRequest {
    pub name: Option<String>,
    pub protocol: Option<String>,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub status: Option<String>,
}

pub async fn list_providers(
    ctx: SaasContext,
    State(state): State<Arc<AppState>>,
) -> Result<Json<ApiResponse<Vec<SaasProviderItem>>>, (StatusCode, Json<ApiResponse<()>>)> {
    let providers = sqlx::query_as::<_, SaasProviderItem>(
        "SELECT 
            pa.id, 
            CASE 
                WHEN pa.name LIKE 'saas-%' THEN 
                    CASE 
                        WHEN pa.provider_type = 'aliyun' THEN 'Aliyun Bailian'
                        WHEN pa.provider_type = 'deepseek' THEN 'DeepSeek'
                        WHEN pa.provider_type = 'openai' THEN 'OpenAI'
                        WHEN pa.provider_type = 'anthropic' THEN 'Anthropic'
                        WHEN pa.provider_type = 'openrouter' THEN 'OpenRouter'
                        ELSE pa.provider_type
                    END
                ELSE pa.name 
            END AS name, 
            pa.provider_type, 
            pa.protocol, 
            pa.base_url, 
            pa.status, 
            COUNT(e.id)::bigint as endpoint_count,
            pa.created_at
         FROM provider_accounts pa
         LEFT JOIN endpoints e ON e.account_id = pa.id
         WHERE pa.org_id = $1
         GROUP BY pa.id, pa.name, pa.provider_type, pa.protocol, pa.base_url, pa.status, pa.created_at
         ORDER BY pa.created_at DESC"
    )
    .bind(&ctx.org_id)
    .fetch_all(&state.db)
    .await
    .map_err(db_error)?;

    Ok(Json(ApiResponse::success(providers)))
}

pub async fn create_provider(
    ctx: SaasContext,
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateSaasProviderRequest>,
) -> Result<Json<ApiResponse<SaasProviderItem>>, (StatusCode, Json<ApiResponse<()>>)> {
    let name = payload.name.trim().to_string();
    let base_url = payload.base_url.trim().to_string();
    let api_key = payload.api_key.trim().to_string();
    let provider_type = payload.provider_type.trim().to_string();
    let protocol = payload.protocol.unwrap_or_else(|| "openai".to_string());

    if name.is_empty() || base_url.is_empty() || api_key.is_empty() || provider_type.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error("Name, provider type, base URL and API key are required")),
        ));
    }

    let id = Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO provider_accounts (id, org_id, name, provider_type, protocol, base_url, api_key, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')"
    )
    .bind(&id)
    .bind(&ctx.org_id)
    .bind(&name)
    .bind(&provider_type)
    .bind(&protocol)
    .bind(&base_url)
    .bind(&api_key)
    .execute(&state.db)
    .await
    .map_err(db_error)?;

    let item = sqlx::query_as::<_, SaasProviderItem>(
        "SELECT 
            pa.id, 
            pa.name, 
            pa.provider_type, 
            pa.protocol, 
            pa.base_url, 
            pa.status, 
            0::bigint as endpoint_count,
            pa.created_at
         FROM provider_accounts pa
         WHERE pa.id = $1"
    )
    .bind(&id)
    .fetch_one(&state.db)
    .await
    .map_err(db_error)?;

    Ok(Json(ApiResponse::success(item)))
}

pub async fn update_provider(
    ctx: SaasContext,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateSaasProviderRequest>,
) -> Result<Json<ApiResponse<()>>, (StatusCode, Json<ApiResponse<()>>)> {
    let mut tx = state.db.begin().await.map_err(db_error)?;

    if let Some(name) = payload.name {
        let name = name.trim().to_string();
        if !name.is_empty() {
            sqlx::query("UPDATE provider_accounts SET name = $1 WHERE id = $2 AND org_id = $3")
                .bind(name)
                .bind(&id)
                .bind(&ctx.org_id)
                .execute(&mut *tx)
                .await
                .map_err(db_error)?;
        }
    }

    if let Some(base_url) = payload.base_url {
        let base_url = base_url.trim().to_string();
        if !base_url.is_empty() {
            sqlx::query("UPDATE provider_accounts SET base_url = $1 WHERE id = $2 AND org_id = $3")
                .bind(base_url)
                .bind(&id)
                .bind(&ctx.org_id)
                .execute(&mut *tx)
                .await
                .map_err(db_error)?;
        }
    }

    if let Some(api_key) = payload.api_key {
        let api_key = api_key.trim().to_string();
        if !api_key.is_empty() {
            sqlx::query("UPDATE provider_accounts SET api_key = $1 WHERE id = $2 AND org_id = $3")
                .bind(api_key)
                .bind(&id)
                .bind(&ctx.org_id)
                .execute(&mut *tx)
                .await
                .map_err(db_error)?;
        }
    }

    if let Some(status) = payload.status {
        sqlx::query("UPDATE provider_accounts SET status = $1 WHERE id = $2 AND org_id = $3")
            .bind(status)
            .bind(&id)
            .bind(&ctx.org_id)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
    }

    tx.commit().await.map_err(db_error)?;

    let _ = crate::sync::sync_all_pools(
        &state.engine,
        &state.db,
        &state.pools,
        &state.pool_members,
        &state.profiles,
        &state.metrics,
    )
    .await;

    Ok(Json(ApiResponse::success(())))
}

pub async fn delete_provider(
    ctx: SaasContext,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<()>>, (StatusCode, Json<ApiResponse<()>>)> {
    let mut tx = state.db.begin().await.map_err(db_error)?;

    // Check if provider has active endpoints
    let count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*)::bigint FROM endpoints WHERE account_id = $1"
    )
    .bind(&id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_error)?;

    if count.0 > 0 {
        return Err((
            StatusCode::CONFLICT,
            Json(ApiResponse::error(format!(
                "Cannot delete provider account: {} active model service endpoints are still linked to it",
                count.0
            ))),
        ));
    }

    sqlx::query("DELETE FROM provider_accounts WHERE id = $1 AND org_id = $2")
        .bind(&id)
        .bind(&ctx.org_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;

    tx.commit().await.map_err(db_error)?;

    Ok(Json(ApiResponse::success(())))
}
