//! Free Token Pool management: public one-click API key claiming,
//! OpenRouter free models auto-sync, quota governance, and key inspection.

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::{DateTime, Utc};
use dashmap::DashMap;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::{api::models::ApiResponse, auth::hash_token, config::AppState, models::Endpoint};

static IP_CLAIM_TRACKER: Lazy<DashMap<String, Mutex<VecDeque<Instant>>>> = Lazy::new(DashMap::new);

/// Rate-limit key creation per client IP using a sliding 1-hour window.
fn check_and_record_ip_claim(ip: &str, limit_per_hour: usize) -> bool {
    let now = Instant::now();
    let window = Duration::from_secs(3600);
    let entry = IP_CLAIM_TRACKER
        .entry(ip.to_string())
        .or_insert_with(|| Mutex::new(VecDeque::new()));
    let mut queue = entry.lock().unwrap_or_else(|e| e.into_inner());

    while queue
        .front()
        .is_some_and(|timestamp| now.duration_since(*timestamp) >= window)
    {
        queue.pop_front();
    }

    if queue.len() >= limit_per_hour {
        return false;
    }

    queue.push_back(now);
    true
}

fn extract_client_ip(headers: &HeaderMap) -> String {
    headers
        .get("cf-connecting-ip")
        .or_else(|| headers.get("x-real-ip"))
        .or_else(|| headers.get("x-forwarded-for"))
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "127.0.0.1".to_string())
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
pub struct FreeTokenPoolConfig {
    pub id: String,
    pub enabled: bool,
    pub default_rpm_limit: i32,
    pub default_concurrency_limit: i32,
    pub default_daily_spend_limit: f64,
    pub max_keys_per_ip_per_hour: i32,
    pub pool_id: String,
    pub project_id: String,
    pub org_id: String,
    #[serde(skip_serializing)]
    pub openrouter_api_key: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FreeTokenPoolConfigView {
    pub id: String,
    pub enabled: bool,
    pub default_rpm_limit: i32,
    pub default_concurrency_limit: i32,
    pub default_daily_spend_limit: f64,
    pub max_keys_per_ip_per_hour: i32,
    pub pool_id: String,
    pub project_id: String,
    pub org_id: String,
    pub has_openrouter_api_key: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<FreeTokenPoolConfig> for FreeTokenPoolConfigView {
    fn from(c: FreeTokenPoolConfig) -> Self {
        let has_key = c
            .openrouter_api_key
            .as_ref()
            .map(|k| !k.trim().is_empty())
            .unwrap_or(false);
        Self {
            id: c.id,
            enabled: c.enabled,
            default_rpm_limit: c.default_rpm_limit,
            default_concurrency_limit: c.default_concurrency_limit,
            default_daily_spend_limit: c.default_daily_spend_limit,
            max_keys_per_ip_per_hour: c.max_keys_per_ip_per_hour,
            pool_id: c.pool_id,
            project_id: c.project_id,
            org_id: c.org_id,
            has_openrouter_api_key: has_key,
            created_at: c.created_at,
            updated_at: c.updated_at,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct ClaimKeyRequest {
    pub name: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct FreeKeyQuota {
    pub rpm_limit: i32,
    pub concurrency_limit: i32,
    pub daily_spend_limit: f64,
}

#[derive(Debug, Serialize)]
pub struct ClaimKeyResponse {
    pub api_key: String,
    pub key_prefix: String,
    pub name: String,
    pub base_url: String,
    pub models: Vec<String>,
    pub default_model: String,
    pub quota: FreeKeyQuota,
}

#[derive(Debug, Deserialize)]
pub struct CheckKeyRequest {
    pub api_key: String,
}

#[derive(Debug, Serialize)]
pub struct CheckKeyResponse {
    pub valid: bool,
    pub key_prefix: String,
    pub name: String,
    pub enabled: bool,
    pub rpm_limit: Option<i32>,
    pub concurrency_limit: Option<i32>,
    pub daily_spend_limit: Option<f64>,
    pub requests_today: i64,
    pub tokens_today: i64,
    pub last_used_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Clone)]
pub struct FreeModelSummary {
    pub id: String,
    pub name: String,
    pub context_length: i32,
    pub is_free: bool,
}

#[derive(Debug, Serialize)]
pub struct FreePoolPublicInfo {
    pub enabled: bool,
    pub default_rpm_limit: i32,
    pub default_concurrency_limit: i32,
    pub default_daily_spend_limit: f64,
    pub available_models: Vec<FreeModelSummary>,
    pub total_keys_issued: i64,
}

#[derive(Debug, Serialize)]
pub struct FreePoolAdminStats {
    pub total_keys_issued: i64,
    pub active_keys: i64,
    pub requests_today: i64,
    pub tokens_today: i64,
    pub active_endpoints: i64,
}

#[derive(Debug, Serialize)]
pub struct AdminFreePoolResponse {
    pub config: FreeTokenPoolConfigView,
    pub stats: FreePoolAdminStats,
    pub models: Vec<FreeModelSummary>,
    pub endpoints: Vec<Endpoint>,
    pub openrouter_configured: bool,
}

#[derive(Debug, Deserialize)]
pub struct UpdateFreePoolSettingsReq {
    pub enabled: Option<bool>,
    pub default_rpm_limit: Option<i32>,
    pub default_concurrency_limit: Option<i32>,
    pub default_daily_spend_limit: Option<f64>,
    pub max_keys_per_ip_per_hour: Option<i32>,
    pub openrouter_api_key: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AdminFreeKeyRow {
    pub id: String,
    pub name: String,
    pub key_prefix: String,
    pub enabled: bool,
    pub rpm_limit: Option<i32>,
    pub concurrency_limit: Option<i32>,
    pub daily_spend_limit: Option<f64>,
    pub requests_today: i64,
    pub tokens_today: i64,
    pub last_used_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateAdminFreeKeyReq {
    pub enabled: Option<bool>,
    pub rpm_limit: Option<i32>,
    pub concurrency_limit: Option<i32>,
    pub daily_spend_limit: Option<f64>,
}

pub async fn get_pool_config(db: &PgPool) -> Result<FreeTokenPoolConfig, sqlx::Error> {
    sqlx::query_as::<_, FreeTokenPoolConfig>(
        "SELECT * FROM free_token_pool_config WHERE id = 'default'",
    )
    .fetch_one(db)
    .await
}

/// Helper to sanitize model IDs for endpoint/virtual model database keys.
fn sanitize_id(raw: &str) -> String {
    raw.chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect()
}

// ---------------------------------------------------------------------------
// Public Handlers
// ---------------------------------------------------------------------------

/// `POST /api/free-token/claim` - Instant free API key issuance without login.
pub async fn claim_free_key(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<ClaimKeyRequest>,
) -> Result<Json<ApiResponse<ClaimKeyResponse>>, (StatusCode, Json<ApiResponse<()>>)> {
    let config = get_pool_config(&state.db).await.map_err(|e| {
        tracing::error!("Failed to fetch free pool config: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::error("Service configuration unavailable")),
        )
    })?;

    if !config.enabled {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ApiResponse::error(
                "Free token key claiming is currently disabled by administrator",
            )),
        ));
    }

    let client_ip = extract_client_ip(&headers);
    if !check_and_record_ip_claim(&client_ip, config.max_keys_per_ip_per_hour as usize) {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            Json(ApiResponse::error(
                "Hourly free key creation limit reached for your IP. Please use your existing key.",
            )),
        ));
    }

    let raw_key = format!("sg-free-{}", uuid::Uuid::new_v4().simple());
    let key_hash = hash_token(&raw_key);
    let key_prefix = format!(
        "{}...{}",
        &raw_key[..11],
        &raw_key[raw_key.len().saturating_sub(4)..]
    );

    let key_id = uuid::Uuid::new_v4().to_string();
    let name_tag = &raw_key[8..16];
    let key_name = match payload
        .name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(custom) => format!("{custom} ({name_tag})"),
        None => format!("Free Key ({name_tag})"),
    };

    sqlx::query(
        "INSERT INTO api_keys (id, project_id, name, key_hash, key_prefix, rpm_limit, concurrency_limit, daily_spend_limit)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(&key_id)
    .bind(&config.project_id)
    .bind(&key_name)
    .bind(&key_hash)
    .bind(&key_prefix)
    .bind(config.default_rpm_limit)
    .bind(config.default_concurrency_limit)
    .bind(config.default_daily_spend_limit)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to create free API key: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::error("Failed to generate API key")),
        )
    })?;

    let models: Vec<String> = sqlx::query_scalar(
        "SELECT vm.name FROM virtual_models vm
         JOIN project_model_grants pmg ON pmg.virtual_model_id = vm.id
         WHERE pmg.project_id = $1 AND vm.enabled = TRUE
         ORDER BY CASE
             WHEN vm.name = 'deepseek/deepseek-r1:free' THEN 0
             WHEN vm.name = 'deepseek/deepseek-chat:free' THEN 1
             WHEN vm.name = 'thudm/glm-4-9b-chat:free' THEN 2
             WHEN vm.name = 'qwen/qwen-2.5-coder-32b-instruct:free' THEN 3
             WHEN vm.name = 'meta-llama/llama-3.3-70b-instruct:free' THEN 4
             WHEN vm.name = 'google/gemini-2.0-flash-exp:free' THEN 5
             WHEN vm.name = 'auto' THEN 8
             WHEN vm.name = 'free-chat' THEN 9
             ELSE 6 END, vm.name",
    )
    .bind(&config.project_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_else(|_| vec!["deepseek/deepseek-r1:free".to_string()]);

    let default_model = models
        .iter()
        .find(|m| m.as_str() != "free-chat" && m.as_str() != "auto")
        .cloned()
        .unwrap_or_else(|| "deepseek/deepseek-r1:free".to_string());

    let quota = FreeKeyQuota {
        rpm_limit: config.default_rpm_limit,
        concurrency_limit: config.default_concurrency_limit,
        daily_spend_limit: config.default_daily_spend_limit,
    };

    Ok(Json(ApiResponse::success(ClaimKeyResponse {
        api_key: raw_key,
        key_prefix,
        name: key_name,
        base_url: "/v1".to_string(),
        models,
        default_model,
        quota,
    })))
}

/// `GET /api/free-token/info` - Public details on free pool availability and models.
pub async fn get_free_pool_info(
    State(state): State<Arc<AppState>>,
) -> Result<Json<ApiResponse<FreePoolPublicInfo>>, (StatusCode, Json<ApiResponse<()>>)> {
    let config = get_pool_config(&state.db).await.map_err(|e| {
        tracing::error!("Failed to read free pool config: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::error("Database error")),
        )
    })?;

    let model_rows: Vec<(String, String, Option<i32>)> = sqlx::query_as(
        "SELECT vm.id, vm.name, e.context_length
         FROM virtual_models vm
         JOIN project_model_grants pmg ON pmg.virtual_model_id = vm.id
         LEFT JOIN model_pool_endpoints mpe ON mpe.pool_id = vm.pool_id
         LEFT JOIN endpoints e ON e.id = mpe.endpoint_id
         WHERE pmg.project_id = $1 AND vm.enabled = TRUE
         ORDER BY CASE WHEN vm.name = 'free-chat' THEN 0 WHEN vm.name = 'auto' THEN 1 ELSE 2 END, vm.name",
    )
    .bind(&config.project_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let mut model_map = HashMap::new();
    for (id, name, ctx) in model_rows {
        let entry = model_map.entry(name.clone()).or_insert(FreeModelSummary {
            id,
            name,
            context_length: ctx.unwrap_or(131072),
            is_free: true,
        });
        if let Some(c) = ctx {
            if c > entry.context_length {
                entry.context_length = c;
            }
        }
    }
    let mut available_models: Vec<FreeModelSummary> = model_map.into_values().collect();
    available_models.sort_by(|a, b| {
        let rank = |name: &str| match name {
            "deepseek/deepseek-r1:free" => 0,
            "deepseek/deepseek-chat:free" => 1,
            "thudm/glm-4-9b-chat:free" => 2,
            "qwen/qwen-2.5-coder-32b-instruct:free" => 3,
            "meta-llama/llama-3.3-70b-instruct:free" => 4,
            "google/gemini-2.0-flash-exp:free" => 5,
            "auto" => 8,
            "free-chat" => 9,
            _ => 6,
        };
        rank(&a.name)
            .cmp(&rank(&b.name))
            .then_with(|| a.name.cmp(&b.name))
    });

    let total_keys: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM api_keys WHERE project_id = $1")
        .bind(&config.project_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

    Ok(Json(ApiResponse::success(FreePoolPublicInfo {
        enabled: config.enabled,
        default_rpm_limit: config.default_rpm_limit,
        default_concurrency_limit: config.default_concurrency_limit,
        default_daily_spend_limit: config.default_daily_spend_limit,
        available_models,
        total_keys_issued: total_keys,
    })))
}

/// `POST /api/free-token/check` - Check valid status, limits, and today's usage for an issued free key.
pub async fn check_free_key(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CheckKeyRequest>,
) -> Result<Json<ApiResponse<CheckKeyResponse>>, (StatusCode, Json<ApiResponse<()>>)> {
    let token = payload.api_key.trim();
    if token.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error("API key is required")),
        ));
    }
    let key_hash = hash_token(token);

    let key_row = sqlx::query_as::<
        _,
        (
            String,
            String,
            String,
            bool,
            Option<i32>,
            Option<i32>,
            Option<f64>,
            Option<DateTime<Utc>>,
            DateTime<Utc>,
        ),
    >(
        "SELECT id, name, key_prefix, enabled, rpm_limit, concurrency_limit, daily_spend_limit, last_used_at, created_at
         FROM api_keys WHERE key_hash = $1",
    )
    .bind(key_hash)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to check key: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::error("Database error")),
        )
    })?;

    match key_row {
        Some((
            id,
            name,
            key_prefix,
            enabled,
            rpm_limit,
            concurrency_limit,
            daily_spend_limit,
            last_used_at,
            created_at,
        )) => {
            let usage: (i64, i64) = sqlx::query_as(
                "SELECT COUNT(*)::bigint, COALESCE(SUM(total_tokens), 0)::bigint
                 FROM usage_logs
                 WHERE key_id = $1 AND timestamp >= date_trunc('day', CURRENT_TIMESTAMP)",
            )
            .bind(&id)
            .fetch_one(&state.db)
            .await
            .unwrap_or((0, 0));

            Ok(Json(ApiResponse::success(CheckKeyResponse {
                valid: true,
                key_prefix,
                name,
                enabled,
                rpm_limit,
                concurrency_limit,
                daily_spend_limit,
                requests_today: usage.0,
                tokens_today: usage.1,
                last_used_at,
                created_at,
            })))
        }
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ApiResponse::error("Invalid or unrecognized API key")),
        )),
    }
}

// ---------------------------------------------------------------------------
// Admin Handlers
// ---------------------------------------------------------------------------

/// `GET /api/admin/free-pool` - Admin view of config, stats, models and bound endpoints.
pub async fn get_admin_free_pool(
    State(state): State<Arc<AppState>>,
) -> Result<Json<ApiResponse<AdminFreePoolResponse>>, (StatusCode, Json<ApiResponse<()>>)> {
    let config = get_pool_config(&state.db).await.map_err(|e| {
        tracing::error!("Admin DB error: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::error("Database error")),
        )
    })?;

    let keys_stat: (i64, i64) = sqlx::query_as(
        "SELECT COUNT(*)::bigint, COUNT(CASE WHEN enabled = TRUE THEN 1 END)::bigint
         FROM api_keys WHERE project_id = $1",
    )
    .bind(&config.project_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or((0, 0));

    let usage_stat: (i64, i64) = sqlx::query_as(
        "SELECT COUNT(*)::bigint, COALESCE(SUM(u.total_tokens), 0)::bigint
         FROM usage_logs u
         JOIN api_keys k ON k.id = u.key_id
         WHERE k.project_id = $1 AND u.timestamp >= date_trunc('day', CURRENT_TIMESTAMP)",
    )
    .bind(&config.project_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or((0, 0));

    let active_ep_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint
         FROM model_pool_endpoints mpe
         JOIN endpoints e ON e.id = mpe.endpoint_id
         WHERE mpe.pool_id = $1 AND e.enabled = TRUE",
    )
    .bind(&config.pool_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let endpoints: Vec<Endpoint> = sqlx::query_as(
        "SELECT e.*
         FROM endpoints e
         JOIN model_pool_endpoints mpe ON mpe.endpoint_id = e.id
         WHERE mpe.pool_id = $1
         ORDER BY mpe.priority DESC, e.name ASC",
    )
    .bind(&config.pool_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let model_rows: Vec<(String, String, Option<i32>)> = sqlx::query_as(
        "SELECT vm.id, vm.name, e.context_length
         FROM virtual_models vm
         JOIN project_model_grants pmg ON pmg.virtual_model_id = vm.id
         LEFT JOIN model_pool_endpoints mpe ON mpe.pool_id = vm.pool_id
         LEFT JOIN endpoints e ON e.id = mpe.endpoint_id
         WHERE pmg.project_id = $1
         ORDER BY CASE WHEN vm.name = 'free-chat' THEN 0 WHEN vm.name = 'auto' THEN 1 ELSE 2 END, vm.name",
    )
    .bind(&config.project_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let mut model_map = HashMap::new();
    for (id, name, ctx) in model_rows {
        let entry = model_map.entry(name.clone()).or_insert(FreeModelSummary {
            id,
            name,
            context_length: ctx.unwrap_or(131072),
            is_free: true,
        });
        if let Some(c) = ctx {
            if c > entry.context_length {
                entry.context_length = c;
            }
        }
    }
    let models: Vec<FreeModelSummary> = model_map.into_values().collect();

    let stats = FreePoolAdminStats {
        total_keys_issued: keys_stat.0,
        active_keys: keys_stat.1,
        requests_today: usage_stat.0,
        tokens_today: usage_stat.1,
        active_endpoints: active_ep_count,
    };

    let openrouter_configured = config
        .openrouter_api_key
        .as_ref()
        .map(|k| !k.trim().is_empty())
        .unwrap_or(false);

    let view = FreeTokenPoolConfigView::from(config);

    Ok(Json(ApiResponse::success(AdminFreePoolResponse {
        config: view,
        stats,
        models,
        endpoints,
        openrouter_configured,
    })))
}

/// `POST /api/admin/free-pool/settings` - Update quota limits and OpenRouter upstream token.
pub async fn update_admin_free_pool_settings(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<UpdateFreePoolSettingsReq>,
) -> Result<Json<ApiResponse<FreeTokenPoolConfigView>>, (StatusCode, Json<ApiResponse<()>>)> {
    let mut current = get_pool_config(&state.db).await.map_err(|e| {
        tracing::error!("Admin DB error: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::error("Database error")),
        )
    })?;

    if let Some(enabled) = payload.enabled {
        current.enabled = enabled;
    }
    if let Some(rpm) = payload.default_rpm_limit {
        current.default_rpm_limit = rpm.max(1);
    }
    if let Some(concurrency) = payload.default_concurrency_limit {
        current.default_concurrency_limit = concurrency.max(1);
    }
    if let Some(spend) = payload.default_daily_spend_limit {
        current.default_daily_spend_limit = spend.max(0.0);
    }
    if let Some(ip_limit) = payload.max_keys_per_ip_per_hour {
        current.max_keys_per_ip_per_hour = ip_limit.max(1);
    }
    if let Some(openrouter_key) = payload.openrouter_api_key {
        let trimmed = openrouter_key.trim();
        current.openrouter_api_key = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        };
    }

    sqlx::query(
        "UPDATE free_token_pool_config
         SET enabled = $1, default_rpm_limit = $2, default_concurrency_limit = $3,
             default_daily_spend_limit = $4, max_keys_per_ip_per_hour = $5,
             openrouter_api_key = $6, updated_at = CURRENT_TIMESTAMP
         WHERE id = 'default'",
    )
    .bind(current.enabled)
    .bind(current.default_rpm_limit)
    .bind(current.default_concurrency_limit)
    .bind(current.default_daily_spend_limit)
    .bind(current.max_keys_per_ip_per_hour)
    .bind(&current.openrouter_api_key)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to update free pool config: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::error("Database update error")),
        )
    })?;

    // Also update provider_accounts row for OpenRouter if it exists
    if let Some(ref key) = current.openrouter_api_key {
        let _ = sqlx::query(
            "UPDATE provider_accounts SET api_key = $1, updated_at = CURRENT_TIMESTAMP WHERE id = 'pa_openrouter_free'",
        )
        .bind(key)
        .execute(&state.db)
        .await;
    }

    Ok(Json(ApiResponse::success(FreeTokenPoolConfigView::from(
        current,
    ))))
}

/// `POST /api/admin/free-pool/sync-openrouter` - Trigger OpenRouter free models auto-import.
pub async fn sync_openrouter_free_models_handler(
    State(state): State<Arc<AppState>>,
) -> Result<Json<ApiResponse<usize>>, (StatusCode, Json<ApiResponse<()>>)> {
    let count = sync_openrouter_free_models(&state, None)
        .await
        .map_err(|e| {
            tracing::error!("Failed to sync OpenRouter free models: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::error(e.to_string())),
            )
        })?;

    Ok(Json(ApiResponse::success(count)))
}

/// `GET /api/admin/free-pool/keys` - List all claimed free keys with usage.
pub async fn list_admin_free_keys(
    State(state): State<Arc<AppState>>,
) -> Result<Json<ApiResponse<Vec<AdminFreeKeyRow>>>, (StatusCode, Json<ApiResponse<()>>)> {
    let config = get_pool_config(&state.db).await.map_err(|e| {
        tracing::error!("Admin DB error: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::error("Database error")),
        )
    })?;

    let keys = sqlx::query_as::<
        _,
        (
            String,
            String,
            String,
            bool,
            Option<i32>,
            Option<i32>,
            Option<f64>,
            Option<DateTime<Utc>>,
            DateTime<Utc>,
        ),
    >(
        "SELECT id, name, key_prefix, enabled, rpm_limit, concurrency_limit, daily_spend_limit, last_used_at, created_at
         FROM api_keys
         WHERE project_id = $1
         ORDER BY created_at DESC
         LIMIT 300",
    )
    .bind(&config.project_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("DB error listing free keys: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::error("Database error")),
        )
    })?;

    let mut rows = Vec::with_capacity(keys.len());
    for (
        id,
        name,
        key_prefix,
        enabled,
        rpm_limit,
        concurrency_limit,
        daily_spend_limit,
        last_used_at,
        created_at,
    ) in keys
    {
        let usage: (i64, i64) = sqlx::query_as(
            "SELECT COUNT(*)::bigint, COALESCE(SUM(total_tokens), 0)::bigint
             FROM usage_logs
             WHERE key_id = $1 AND timestamp >= date_trunc('day', CURRENT_TIMESTAMP)",
        )
        .bind(&id)
        .fetch_one(&state.db)
        .await
        .unwrap_or((0, 0));

        rows.push(AdminFreeKeyRow {
            id,
            name,
            key_prefix,
            enabled,
            rpm_limit,
            concurrency_limit,
            daily_spend_limit,
            requests_today: usage.0,
            tokens_today: usage.1,
            last_used_at,
            created_at,
        });
    }

    Ok(Json(ApiResponse::success(rows)))
}

/// `PATCH /api/admin/free-pool/keys/:id` - Update status or quotas for an individual free key.
pub async fn update_admin_free_key(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateAdminFreeKeyReq>,
) -> Result<Json<ApiResponse<()>>, (StatusCode, Json<ApiResponse<()>>)> {
    let config = get_pool_config(&state.db).await.map_err(|e| {
        tracing::error!("Admin DB error: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::error("Database error")),
        )
    })?;

    if let Some(enabled) = payload.enabled {
        sqlx::query(
            "UPDATE api_keys SET enabled = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND project_id = $3",
        )
        .bind(enabled)
        .bind(&id)
        .bind(&config.project_id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to update key enabled: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ApiResponse::error("Database error")))
        })?;
    }

    if payload.rpm_limit.is_some()
        || payload.concurrency_limit.is_some()
        || payload.daily_spend_limit.is_some()
    {
        sqlx::query(
            "UPDATE api_keys
             SET rpm_limit = COALESCE($1, rpm_limit),
                 concurrency_limit = COALESCE($2, concurrency_limit),
                 daily_spend_limit = COALESCE($3, daily_spend_limit),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $4 AND project_id = $5",
        )
        .bind(payload.rpm_limit)
        .bind(payload.concurrency_limit)
        .bind(payload.daily_spend_limit)
        .bind(&id)
        .bind(&config.project_id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to update key quota: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::error("Database error")),
            )
        })?;
    }

    Ok(Json(ApiResponse::success(())))
}

/// `DELETE /api/admin/free-pool/keys/:id` - Revoke / delete a free key.
pub async fn delete_admin_free_key(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<()>>, (StatusCode, Json<ApiResponse<()>>)> {
    let config = get_pool_config(&state.db).await.map_err(|e| {
        tracing::error!("Admin DB error: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::error("Database error")),
        )
    })?;

    sqlx::query("DELETE FROM api_keys WHERE id = $1 AND project_id = $2")
        .bind(&id)
        .bind(&config.project_id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to delete free key: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::error("Database error")),
            )
        })?;

    Ok(Json(ApiResponse::success(())))
}

// ---------------------------------------------------------------------------
// OpenRouter Free Models Auto-Sync Engine
// ---------------------------------------------------------------------------

/// Syncs free models from OpenRouter (or built-in free catalog) directly into
/// `pa_openrouter_free`, binds them to `pool_free_tokens`, creates virtual models,
/// and reloads the engine routing tables.
pub async fn sync_openrouter_free_models(
    state: &AppState,
    override_api_key: Option<&str>,
) -> anyhow::Result<usize> {
    let config = get_pool_config(&state.db).await?;

    let effective_key = override_api_key
        .map(str::to_string)
        .or_else(|| config.openrouter_api_key.clone())
        .unwrap_or_default();

    // 1. Ensure OpenRouter Free Provider Account exists
    sqlx::query(
        "INSERT INTO provider_accounts (id, org_id, name, provider_type, protocol, base_url, api_key, status)
         VALUES ('pa_openrouter_free', $1, 'OpenRouter Free Pool', 'openrouter', 'openai', 'https://openrouter.ai/api/v1', $2, 'active')
         ON CONFLICT (id) DO UPDATE SET
             api_key = EXCLUDED.api_key,
             status = 'active',
             updated_at = CURRENT_TIMESTAMP",
    )
    .bind(&config.org_id)
    .bind(&effective_key)
    .execute(&state.db)
    .await?;

    // 2. Ensure default Model Pool exists
    sqlx::query(
        "INSERT INTO model_pools (id, org_id, name, strategy, enabled)
         VALUES ($1, $2, 'free-token-pool', 'cost_aware', TRUE)
         ON CONFLICT (id) DO NOTHING",
    )
    .bind(&config.pool_id)
    .bind(&config.org_id)
    .execute(&state.db)
    .await?;

    // 3. Check if openrouter_market_models table has free models; if empty, sync or seed
    let free_market_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM openrouter_market_models WHERE is_free = 1 OR id LIKE '%:free'",
    )
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    if free_market_count == 0 {
        // Try live sync
        let _ = crate::sync::openrouter::sync_openrouter_market(&state.db).await;
    }

    // Check again
    let free_market_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM openrouter_market_models WHERE is_free = 1 OR id LIKE '%:free'",
    )
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    // If still 0 (e.g. offline/network restricted in test environment), seed well-known free models
    if free_market_count == 0 {
        let seed_models = [
            ("deepseek/deepseek-r1:free", "DeepSeek: R1 (free)", 65536),
            (
                "deepseek/deepseek-chat:free",
                "DeepSeek: DeepSeek V3 (free)",
                65536,
            ),
            (
                "thudm/glm-4-9b-chat:free",
                "Zhipu AI: GLM-4 9B Chat (free)",
                32768,
            ),
            (
                "meta-llama/llama-3.3-70b-instruct:free",
                "Meta: Llama 3.3 70B Instruct (free)",
                131072,
            ),
            (
                "qwen/qwen-2.5-coder-32b-instruct:free",
                "Qwen: Qwen 2.5 Coder 32B Instruct (free)",
                32768,
            ),
            (
                "google/gemini-2.0-flash-exp:free",
                "Google: Gemini 2.0 Flash Experimental (free)",
                1048576,
            ),
            (
                "mistralai/mistral-7b-instruct:free",
                "Mistral: Mistral 7B Instruct (free)",
                32768,
            ),
        ];

        for (id, name, ctx) in seed_models {
            let _ = sqlx::query(
                "INSERT INTO openrouter_market_models (id, name, context_length, prompt_price_per_1m, completion_price_per_1m, is_free)
                 VALUES ($1, $2, $3, 0.0, 0.0, 1)
                 ON CONFLICT (id) DO UPDATE SET is_free = 1",
            )
            .bind(id)
            .bind(name)
            .bind(ctx)
            .execute(&state.db)
            .await;
        }
    }

    // 4. Fetch all free models from catalog
    let free_models: Vec<(String, String, i32)> = sqlx::query_as(
        "SELECT id, name, context_length
         FROM openrouter_market_models
         WHERE is_free = 1 OR id LIKE '%:free'
         ORDER BY id ASC",
    )
    .fetch_all(&state.db)
    .await?;

    let mut synced_count = 0;

    for (model_id, model_name, context_len) in &free_models {
        let ep_id = format!("ep_or_{}", sanitize_id(model_id));
        let vm_id = format!("vm_or_{}", sanitize_id(model_id));

        // Create or update physical endpoint
        sqlx::query(
            "INSERT INTO endpoints (
                id, account_id, name, upstream_model_id, enabled, priority, weight,
                health_status, input_price_per_1m, output_price_per_1m,
                capability_score, supports_tools, context_length
            ) VALUES ($1, 'pa_openrouter_free', $2, $3, TRUE, 10, 10, 'healthy', 0.0, 0.0, 0.85, 1, $4)
            ON CONFLICT (id) DO UPDATE SET
                account_id = 'pa_openrouter_free',
                name = EXCLUDED.name,
                upstream_model_id = EXCLUDED.upstream_model_id,
                enabled = TRUE,
                input_price_per_1m = 0.0,
                output_price_per_1m = 0.0,
                context_length = EXCLUDED.context_length,
                updated_at = CURRENT_TIMESTAMP",
        )
        .bind(&ep_id)
        .bind(model_name)
        .bind(model_id)
        .bind(context_len)
        .execute(&state.db)
        .await?;

        let dedicated_pool_id = format!("pool_or_{}", sanitize_id(model_id));

        // Create dedicated pool for this specific model
        sqlx::query(
            "INSERT INTO model_pools (id, org_id, name, strategy, enabled)
             VALUES ($1, $2, $3, 'priority', TRUE)
             ON CONFLICT (id) DO NOTHING",
        )
        .bind(&dedicated_pool_id)
        .bind(&config.org_id)
        .bind(model_id)
        .execute(&state.db)
        .await?;

        // Bind endpoint to dedicated pool
        sqlx::query(
            "INSERT INTO model_pool_endpoints (pool_id, endpoint_id, priority, weight)
             VALUES ($1, $2, 10, 10)
             ON CONFLICT (pool_id, endpoint_id) DO UPDATE SET
                 priority = 10, weight = 10",
        )
        .bind(&dedicated_pool_id)
        .bind(&ep_id)
        .execute(&state.db)
        .await?;

        // Also bind endpoint to global free pool
        sqlx::query(
            "INSERT INTO model_pool_endpoints (pool_id, endpoint_id, priority, weight)
             VALUES ($1, $2, 10, 10)
             ON CONFLICT (pool_id, endpoint_id) DO UPDATE SET
                 priority = 10, weight = 10",
        )
        .bind(&config.pool_id)
        .bind(&ep_id)
        .execute(&state.db)
        .await?;

        // Create or update virtual model pointing to its dedicated pool
        sqlx::query(
            "INSERT INTO virtual_models (id, pool_id, name, enabled)
             VALUES ($1, $2, $3, TRUE)
             ON CONFLICT (id) DO UPDATE SET
                 pool_id = EXCLUDED.pool_id,
                 name = EXCLUDED.name,
                 enabled = TRUE,
                 updated_at = CURRENT_TIMESTAMP",
        )
        .bind(&vm_id)
        .bind(&dedicated_pool_id)
        .bind(model_id)
        .execute(&state.db)
        .await?;

        // Grant virtual model to free project
        sqlx::query(
            "INSERT INTO project_model_grants (project_id, virtual_model_id)
             VALUES ($1, $2)
             ON CONFLICT (project_id, virtual_model_id) DO NOTHING",
        )
        .bind(&config.project_id)
        .bind(&vm_id)
        .execute(&state.db)
        .await?;

        synced_count += 1;
    }

    // 5. Ensure free-chat and auto virtual models exist and are granted
    let aliases = [("vm_free_chat", "free-chat"), ("vm_free_auto", "auto")];
    for (vm_id, vm_name) in aliases {
        sqlx::query(
            "INSERT INTO virtual_models (id, pool_id, name, enabled)
             VALUES ($1, $2, $3, TRUE)
             ON CONFLICT (id) DO UPDATE SET pool_id = EXCLUDED.pool_id, enabled = TRUE",
        )
        .bind(vm_id)
        .bind(&config.pool_id)
        .bind(vm_name)
        .execute(&state.db)
        .await?;

        sqlx::query(
            "INSERT INTO project_model_grants (project_id, virtual_model_id)
             VALUES ($1, $2)
             ON CONFLICT (project_id, virtual_model_id) DO NOTHING",
        )
        .bind(&config.project_id)
        .bind(vm_id)
        .execute(&state.db)
        .await?;
    }

    // 6. Push updated pool state into UniGateway and reload in-memory structures
    crate::sync::sync_all_pools(
        &state.engine,
        &state.db,
        &state.pools,
        &state.pool_members,
        &state.profiles,
        &state.metrics,
    )
    .await?;

    tracing::info!(
        target: "smartgate.free_token",
        synced_count,
        "successfully synced free models to Free Token Pool"
    );

    Ok(synced_count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ip_claim_limiter_enforces_hourly_capacity() {
        let test_ip = format!("192.0.2.{}", uuid::Uuid::new_v4().simple());
        let limit = 3;

        assert!(check_and_record_ip_claim(&test_ip, limit));
        assert!(check_and_record_ip_claim(&test_ip, limit));
        assert!(check_and_record_ip_claim(&test_ip, limit));
        // 4th attempt should be rejected
        assert!(!check_and_record_ip_claim(&test_ip, limit));
    }

    #[test]
    fn sanitize_id_replaces_special_chars() {
        let raw = "meta-llama/llama-3.3-70b-instruct:free";
        let sanitized = sanitize_id(raw);
        assert_eq!(sanitized, "meta_llama_llama_3_3_70b_instruct_free");
        assert!(sanitized.chars().all(|c| c.is_alphanumeric() || c == '_'));
    }

    #[test]
    fn free_key_formatting_and_prefix() {
        let raw_key = format!("sg-free-{}", uuid::Uuid::new_v4().simple());
        assert!(raw_key.starts_with("sg-free-"));
        let prefix = format!(
            "{}...{}",
            &raw_key[..11],
            &raw_key[raw_key.len().saturating_sub(4)..]
        );
        assert!(prefix.starts_with("sg-free-"));
        assert!(prefix.contains("..."));
        let hash = hash_token(&raw_key);
        assert_eq!(hash.len(), 64);
    }

    #[test]
    fn view_conversion_detects_configured_key() {
        let config = FreeTokenPoolConfig {
            id: "default".to_string(),
            enabled: true,
            default_rpm_limit: 20,
            default_concurrency_limit: 2,
            default_daily_spend_limit: 5.0,
            max_keys_per_ip_per_hour: 10,
            pool_id: "pool_free_tokens".to_string(),
            project_id: "proj_free_tokens".to_string(),
            org_id: "org_free_tokens".to_string(),
            openrouter_api_key: Some("sk-or-test-key".to_string()),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let view = FreeTokenPoolConfigView::from(config);
        assert!(view.has_openrouter_api_key);
        assert_eq!(view.default_rpm_limit, 20);
        assert_eq!(view.default_concurrency_limit, 2);
    }
}
