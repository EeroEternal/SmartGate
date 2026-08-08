use axum::{
    extract::{State, Json},
    http::StatusCode,
};
use std::sync::Arc;
use crate::config::AppState;
use crate::api::models::ApiResponse;

pub async fn get_stats(
    State(state): State<Arc<AppState>>,
) -> Result<Json<ApiResponse<serde_json::Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    let row: (Option<i32>, Option<f64>, i32) = sqlx::query_as(
        "SELECT SUM(total_tokens), AVG(latency_ms), COUNT(*) FROM usage_logs"
    )
    .fetch_one(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, Json(ApiResponse::error("Database error"))))?;

    let health_rows: Vec<(String, i32)> = sqlx::query_as(
        "SELECT health_status, COUNT(*) FROM endpoints GROUP BY health_status"
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let mut healthy = 0;
    let mut degraded = 0;
    let mut unavailable = 0;
    for (status, count) in health_rows {
        match status.as_str() {
            "degraded" => degraded = count,
            "unavailable" => unavailable = count,
            _ => healthy += count,
        }
    }

    // Prefer live in-memory health when the process has seen traffic.
    let mut live_healthy = 0i32;
    let mut live_degraded = 0i32;
    let mut live_unavailable = 0i32;
    let mut has_live = false;
    for entry in state.metrics.iter() {
        has_live = true;
        match entry.health_status.as_str() {
            "degraded" => live_degraded += 1,
            "unavailable" => live_unavailable += 1,
            _ => live_healthy += 1,
        }
    }
    if has_live {
        healthy = live_healthy;
        degraded = live_degraded;
        unavailable = live_unavailable;
    }

    Ok(Json(ApiResponse::success(serde_json::json!({
        "total_tokens": row.0.unwrap_or(0),
        "avg_latency": row.1.unwrap_or(0.0),
        "request_count": row.2,
        "endpoint_health": {
            "healthy": healthy,
            "degraded": degraded,
            "unavailable": unavailable
        }
    }))))
}
