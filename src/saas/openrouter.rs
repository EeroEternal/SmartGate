use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::{
    api::models::ApiResponse,
    config::AppState,
    models::OpenRouterMarketModel,
    saas::SaasContext,
};

#[derive(Debug, Deserialize)]
pub struct OpenRouterMarketQuery {
    pub search: Option<String>,
    pub free_only: Option<bool>,
    pub min_discount: Option<f64>,
    pub min_context: Option<i32>,
    pub sort: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct OpenRouterMarketStats {
    pub total_models: i64,
    pub free_models: i64,
    pub discounted_models: i64,
    pub last_synced_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Serialize)]
pub struct OpenRouterMarketResponse {
    pub stats: OpenRouterMarketStats,
    pub models: Vec<OpenRouterMarketModel>,
    pub total_count: i64,
    pub page: i64,
    pub page_size: i64,
    pub total_pages: i64,
}

pub async fn get_openrouter_market(
    _ctx: SaasContext,
    State(state): State<Arc<AppState>>,
    Query(query): Query<OpenRouterMarketQuery>,
) -> Result<Json<ApiResponse<OpenRouterMarketResponse>>, (StatusCode, Json<ApiResponse<()>>)> {
    let mut where_clause = String::from("WHERE 1=1");

    if let Some(true) = query.free_only {
        where_clause.push_str(" AND is_free = 1");
    }

    if let Some(min_disc) = query.min_discount {
        if min_disc > 0.0 {
            where_clause.push_str(&format!(" AND discount_ratio >= {}", min_disc));
        }
    }

    if let Some(min_ctx) = query.min_context {
        if min_ctx > 0 {
            where_clause.push_str(&format!(" AND context_length >= {}", min_ctx));
        }
    }

    if let Some(ref search) = query.search {
        let trimmed = search.trim();
        if !trimmed.is_empty() {
            let escaped = trimmed.replace('\'', "''");
            where_clause.push_str(&format!(
                " AND (id ILIKE '%{}%' OR name ILIKE '%{}%' OR description ILIKE '%{}%')",
                escaped, escaped, escaped
            ));
        }
    }

    let count_sql = format!("SELECT COUNT(*)::bigint FROM openrouter_market_models {}", where_clause);
    let total_count: (i64,) = sqlx::query_as(&count_sql)
        .fetch_one(&state.db)
        .await
        .unwrap_or((0,));

    let page_size = query.page_size.unwrap_or(12).clamp(1, 1000);
    let total_pages = ((total_count.0 as f64) / (page_size as f64)).ceil().max(1.0) as i64;
    let page = query.page.unwrap_or(1).clamp(1, total_pages);
    let offset = (page - 1) * page_size;

    let mut sql = format!("SELECT * FROM openrouter_market_models {}", where_clause);

    match query.sort.as_deref() {
        Some("price_asc") => sql.push_str(" ORDER BY is_free DESC, prompt_price_per_1m ASC, completion_price_per_1m ASC"),
        Some("price_desc") => sql.push_str(" ORDER BY prompt_price_per_1m DESC, completion_price_per_1m DESC"),
        Some("discount_desc") => sql.push_str(" ORDER BY discount_ratio DESC, is_free DESC, prompt_price_per_1m ASC"),
        Some("context_desc") => sql.push_str(" ORDER BY context_length DESC"),
        Some("newest") => sql.push_str(" ORDER BY created_at DESC NULLS LAST"),
        _ => sql.push_str(" ORDER BY is_free DESC, discount_ratio DESC, id ASC"),
    }

    sql.push_str(&format!(" LIMIT {} OFFSET {}", page_size, offset));

    let models = sqlx::query_as::<_, OpenRouterMarketModel>(&sql)
        .fetch_all(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("DB error fetching openrouter models: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ApiResponse::error("Database error")))
        })?;

    let stats_row: (i64, i64, i64, Option<chrono::DateTime<chrono::Utc>>) = sqlx::query_as(
        "SELECT 
            COUNT(*)::bigint, 
            COUNT(CASE WHEN is_free = 1 THEN 1 END)::bigint, 
            COUNT(CASE WHEN discount_ratio > 0 THEN 1 END)::bigint, 
            MAX(synced_at) 
         FROM openrouter_market_models"
    )
    .fetch_one(&state.db)
    .await
    .unwrap_or((0, 0, 0, None));

    let stats = OpenRouterMarketStats {
        total_models: stats_row.0,
        free_models: stats_row.1,
        discounted_models: stats_row.2,
        last_synced_at: stats_row.3,
    };

    Ok(Json(ApiResponse::success(OpenRouterMarketResponse {
        stats,
        models,
        total_count: total_count.0,
        page,
        page_size,
        total_pages,
    })))
}

pub async fn trigger_openrouter_sync(
    _ctx: SaasContext,
    State(state): State<Arc<AppState>>,
) -> Result<Json<ApiResponse<usize>>, (StatusCode, Json<ApiResponse<()>>)> {
    let count = crate::sync::openrouter::sync_openrouter_market(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to manually sync OpenRouter market models: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ApiResponse::error(e.to_string())))
        })?;

    Ok(Json(ApiResponse::success(count)))
}
