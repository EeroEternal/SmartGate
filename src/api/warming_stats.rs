use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use chrono::{Duration, Utc};
use serde::Deserialize;
use std::sync::Arc;

use crate::api::models::ApiResponse;
use crate::config::AppState;

#[derive(Debug, Deserialize)]
pub struct WarmingStatsQuery {
    pub pool_id: Option<String>,
    pub days: Option<i64>,
}

pub async fn get_warming_stats(
    State(state): State<Arc<AppState>>,
    Query(query): Query<WarmingStatsQuery>,
) -> Result<Json<ApiResponse<serde_json::Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    let days = query.days.unwrap_or(7).clamp(1, 90);
    let since = Utc::now() - Duration::days(days);

    let affinity_row: (i64, i64, i64, i64) = if let Some(ref pool_id) = query.pool_id {
        sqlx::query_as(
            "SELECT COUNT(*),
                    COUNT(*) FILTER (WHERE session_id IS NOT NULL),
                    COUNT(*) FILTER (WHERE affinity_applied = 1),
                    COUNT(*) FILTER (WHERE affinity_hit = 1)
             FROM usage_logs WHERE timestamp >= $1 AND pool_id = $2",
        )
        .bind(since)
        .bind(pool_id)
        .fetch_one(&state.db)
        .await
    } else {
        sqlx::query_as(
            "SELECT COUNT(*),
                    COUNT(*) FILTER (WHERE session_id IS NOT NULL),
                    COUNT(*) FILTER (WHERE affinity_applied = 1),
                    COUNT(*) FILTER (WHERE affinity_hit = 1)
             FROM usage_logs WHERE timestamp >= $1",
        )
        .bind(since)
        .fetch_one(&state.db)
        .await
    }
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::error("Database error")),
        )
    })?;

    let turn1: (Option<f64>, Option<f64>, Option<f64>, i64) = if let Some(ref pool_id) = query.pool_id {
        sqlx::query_as(
            "SELECT AVG(latency_ms), AVG(ttft_ms), AVG(cached_input_tokens), COUNT(*)
             FROM usage_logs
             WHERE timestamp >= $1 AND session_id IS NOT NULL AND turn_index = 1 AND pool_id = $2",
        )
        .bind(since)
        .bind(pool_id)
        .fetch_one(&state.db)
        .await
    } else {
        sqlx::query_as(
            "SELECT AVG(latency_ms), AVG(ttft_ms), AVG(cached_input_tokens), COUNT(*)
             FROM usage_logs
             WHERE timestamp >= $1 AND session_id IS NOT NULL AND turn_index = 1",
        )
        .bind(since)
        .fetch_one(&state.db)
        .await
    }
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::error("Database error")),
        )
    })?;

    let turn2: (Option<f64>, Option<f64>, Option<f64>, i64, Option<i64>, Option<i64>) =
        if let Some(ref pool_id) = query.pool_id {
            sqlx::query_as(
                "SELECT AVG(latency_ms), AVG(ttft_ms), AVG(cached_input_tokens), COUNT(*),
                        SUM(cached_input_tokens), SUM(prompt_tokens)
                 FROM usage_logs
                 WHERE timestamp >= $1 AND session_id IS NOT NULL AND turn_index >= 2 AND pool_id = $2",
            )
            .bind(since)
            .bind(pool_id)
            .fetch_one(&state.db)
            .await
        } else {
            sqlx::query_as(
                "SELECT AVG(latency_ms), AVG(ttft_ms), AVG(cached_input_tokens), COUNT(*),
                        SUM(cached_input_tokens), SUM(prompt_tokens)
                 FROM usage_logs
                 WHERE timestamp >= $1 AND session_id IS NOT NULL AND turn_index >= 2",
            )
            .bind(since)
            .fetch_one(&state.db)
            .await
        }
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::error("Database error")),
            )
        })?;

    let by_turn: Vec<(i32, i64, Option<f64>, Option<f64>, Option<f64>)> =
        if let Some(ref pool_id) = query.pool_id {
            sqlx::query_as(
                "SELECT turn_index, COUNT(*), AVG(latency_ms), AVG(ttft_ms), AVG(cached_input_tokens)
                 FROM usage_logs
                 WHERE timestamp >= $1 AND session_id IS NOT NULL AND turn_index IS NOT NULL AND pool_id = $2
                 GROUP BY turn_index ORDER BY turn_index LIMIT 20",
            )
            .bind(since)
            .bind(pool_id)
            .fetch_all(&state.db)
            .await
        } else {
            sqlx::query_as(
                "SELECT turn_index, COUNT(*), AVG(latency_ms), AVG(ttft_ms), AVG(cached_input_tokens)
                 FROM usage_logs
                 WHERE timestamp >= $1 AND session_id IS NOT NULL AND turn_index IS NOT NULL
                 GROUP BY turn_index ORDER BY turn_index LIMIT 20",
            )
            .bind(since)
            .fetch_all(&state.db)
            .await
        }
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::error("Database error")),
            )
        })?;

    let sessions: (i64,) = if let Some(ref pool_id) = query.pool_id {
        sqlx::query_as(
            "SELECT COUNT(DISTINCT session_id) FROM usage_logs
             WHERE timestamp >= $1 AND session_id IS NOT NULL AND pool_id = $2",
        )
        .bind(since)
        .bind(pool_id)
        .fetch_one(&state.db)
        .await
    } else {
        sqlx::query_as(
            "SELECT COUNT(DISTINCT session_id) FROM usage_logs
             WHERE timestamp >= $1 AND session_id IS NOT NULL",
        )
        .bind(since)
        .fetch_one(&state.db)
        .await
    }
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::error("Database error")),
        )
    })?;

    let hit_rate = if affinity_row.2 > 0 {
        affinity_row.3 as f64 / affinity_row.2 as f64
    } else {
        0.0
    };
    let turn1_latency = turn1.0.unwrap_or(0.0);
    let turn2_latency = turn2.0.unwrap_or(0.0);
    let lift_pct = if turn1_latency > 0.0 && turn2.3 > 0 {
        ((turn1_latency - turn2_latency) / turn1_latency * 100.0).max(0.0)
    } else {
        0.0
    };
    let cached_sum = turn2.4.unwrap_or(0) as f64;
    let prompt_sum = turn2.5.unwrap_or(0) as f64;
    let cached_token_rate = if prompt_sum > 0.0 {
        cached_sum / prompt_sum
    } else {
        0.0
    };

    Ok(Json(ApiResponse::success(serde_json::json!({
        "window_days": days,
        "pool_id": query.pool_id,
        "sessions_with_id": sessions.0,
        "requests_with_session": affinity_row.1,
        "affinity": {
            "applied_count": affinity_row.2,
            "hit_count": affinity_row.3,
            "hit_rate": hit_rate,
        },
        "latency": {
            "turn1_avg_ms": turn1_latency,
            "turn1_avg_ttft_ms": turn1.1.unwrap_or(0.0),
            "turn1_count": turn1.3,
            "turn2plus_avg_ms": turn2_latency,
            "turn2plus_avg_ttft_ms": turn2.1.unwrap_or(0.0),
            "turn2plus_count": turn2.3,
            "lift_pct": lift_pct,
        },
        "cache": {
            "turn2plus_total_cached_tokens": turn2.4.unwrap_or(0),
            "turn2plus_total_prompt_tokens": turn2.5.unwrap_or(0),
            "cached_token_rate": cached_token_rate,
            "turn2plus_avg_cached_tokens": turn2.2.unwrap_or(0.0),
        },
        "by_turn": by_turn.into_iter().map(|(turn, n, lat, ttft, cached)| {
            serde_json::json!({
                "turn_index": turn,
                "count": n,
                "avg_latency_ms": lat.unwrap_or(0.0),
                "avg_ttft_ms": ttft.unwrap_or(0.0),
                "avg_cached_tokens": cached.unwrap_or(0.0),
            })
        }).collect::<Vec<_>>(),
    }))))
}
