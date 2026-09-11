use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::{
    api::models::ApiResponse, config::AppState, models::OpenRouterMarketModel, saas::SaasContext,
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
    // All user-supplied values are bound parameters; only fixed predicate
    // fragments and static ORDER BY/LIMIT clauses are concatenated.
    let mut where_clause = String::from("WHERE 1=1");
    let mut bind_idx = 0usize;

    let mut min_discount = None;
    if let Some(value) = query.min_discount.filter(|d| *d > 0.0) {
        bind_idx += 1;
        where_clause.push_str(&format!(" AND discount_ratio >= ${bind_idx}"));
        min_discount = Some(value);
    }

    let mut min_context = None;
    if let Some(value) = query.min_context.filter(|c| *c > 0) {
        bind_idx += 1;
        where_clause.push_str(&format!(" AND context_length >= ${bind_idx}"));
        min_context = Some(value);
    }

    let mut search_pattern = None;
    if let Some(term) = query
        .search
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        bind_idx += 1;
        // Only match id and name; description matching is too noisy for short queries.
        where_clause.push_str(&format!(
            " AND (id ILIKE ${bind_idx} OR name ILIKE ${bind_idx})"
        ));
        search_pattern = Some(format!("%{term}%"));
    }

    let count_sql = format!("SELECT COUNT(*)::bigint FROM openrouter_market_models {where_clause}");
    let mut count_query = sqlx::query_as::<_, (i64,)>(&count_sql);
    if let Some(value) = min_discount {
        count_query = count_query.bind(value);
    }
    if let Some(value) = min_context {
        count_query = count_query.bind(value);
    }
    if let Some(ref pattern) = search_pattern {
        count_query = count_query.bind(pattern);
    }
    let total_count = count_query.fetch_one(&state.db).await.map_err(|e| {
        tracing::error!("DB error counting openrouter models: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::error("Database error")),
        )
    })?;

    let page_size = query.page_size.unwrap_or(12).clamp(1, 1000);
    let total_pages = ((total_count.0 as f64) / (page_size as f64))
        .ceil()
        .max(1.0) as i64;
    let page = query.page.unwrap_or(1).clamp(1, total_pages);
    let offset = (page - 1) * page_size;

    let mut sql = format!("SELECT * FROM openrouter_market_models {where_clause}");

    let mut search_order_idx = None;
    if let Some(ref pattern) = search_pattern {
        bind_idx += 1;
        search_order_idx = Some((bind_idx, pattern.clone()));
        sql.push_str(&format!(
            " ORDER BY CASE WHEN id ILIKE ${bind_idx} THEN 0 WHEN name ILIKE ${bind_idx} THEN 1 ELSE 2 END, is_free DESC, discount_ratio DESC, id ASC"
        ));
    } else {
        match query.sort.as_deref() {
            Some("price_asc") => sql.push_str(
                " ORDER BY is_free DESC, prompt_price_per_1m ASC, completion_price_per_1m ASC",
            ),
            Some("price_desc") => {
                sql.push_str(" ORDER BY prompt_price_per_1m DESC, completion_price_per_1m DESC")
            }
            Some("discount_desc") => {
                sql.push_str(" ORDER BY discount_ratio DESC, is_free DESC, prompt_price_per_1m ASC")
            }
            Some("context_desc") => sql.push_str(" ORDER BY context_length DESC"),
            Some("newest") => sql.push_str(" ORDER BY created_at DESC NULLS LAST"),
            _ => sql.push_str(" ORDER BY is_free DESC, discount_ratio DESC, id ASC"),
        }
    }

    let limit_idx = bind_idx + 1;
    let offset_idx = bind_idx + 2;
    sql.push_str(&format!(" LIMIT ${limit_idx} OFFSET ${offset_idx}"));

    let mut models_query = sqlx::query_as::<_, OpenRouterMarketModel>(&sql);
    if let Some(value) = min_discount {
        models_query = models_query.bind(value);
    }
    if let Some(value) = min_context {
        models_query = models_query.bind(value);
    }
    if let Some(ref pattern) = search_pattern {
        models_query = models_query.bind(pattern);
    }
    if let Some((_, ref pattern)) = search_order_idx {
        models_query = models_query.bind(pattern);
    }
    let models = models_query
        .bind(page_size)
        .bind(offset)
        .fetch_all(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("DB error fetching openrouter models: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::error("Database error")),
            )
        })?;

    let stats_row: (i64, i64, i64, Option<chrono::DateTime<chrono::Utc>>) = sqlx::query_as(
        "SELECT 
            COUNT(*)::bigint, 
            COUNT(CASE WHEN is_free = 1 THEN 1 END)::bigint, 
            COUNT(CASE WHEN discount_ratio > 0 THEN 1 END)::bigint, 
            MAX(synced_at) 
         FROM openrouter_market_models",
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
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::error(e.to_string())),
            )
        })?;

    Ok(Json(ApiResponse::success(count)))
}
