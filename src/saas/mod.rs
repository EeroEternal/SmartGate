use axum::{
    async_trait,
    extract::{FromRef, FromRequestParts, Path, Query, State},
    http::{header, request::Parts, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, patch, post},
    Json, Router,
};
use chrono::{Duration, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{FromRow, PgPool};
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    api::models::ApiResponse,
    auth::hash_token,
    config::AppState,
    policy::{evaluate_budget, BudgetOutcome},
};

const SESSION_COOKIE: &str = "smartgate_session";
const SESSION_DAYS: i64 = 30;

#[derive(Debug, Clone, FromRow)]
pub struct SaasUser {
    pub id: String,
    pub email: String,
    pub password_hash: String,
    pub status: String,
}

#[derive(Debug, Clone)]
pub struct SaasContext {
    pub user: SaasUser,
    pub org_id: String,
    pub project_id: String,
}

#[derive(Debug, Deserialize)]
struct RegisterRequest {
    email: String,
    password: String,
}

#[derive(Debug, Deserialize)]
struct LoginRequest {
    email: String,
    password: String,
}

#[derive(Debug, Deserialize, Clone)]
struct ModelEndpointRequest {
    provider_type: String,
    base_url: String,
    api_key: String,
    upstream_model_id: String,
    input_price_per_1m: Option<f64>,
    output_price_per_1m: Option<f64>,
    capability_score: Option<f64>,
    supports_tools: Option<bool>,
    context_length: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct ModelServiceRequest {
    name: String,
    #[serde(default)]
    endpoints: Vec<ModelEndpointRequest>,
    // Keep the legacy fields readable for existing API clients. New clients should use endpoints.
    provider_type: Option<String>,
    base_url: Option<String>,
    api_key: Option<String>,
    upstream_model_id: Option<String>,
    strategy: Option<String>,
    input_price_per_1m: Option<f64>,
    output_price_per_1m: Option<f64>,
    capability_score: Option<f64>,
    supports_tools: Option<bool>,
    context_length: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct CreateSaasKeyRequest {
    name: String,
    daily_spend_limit: Option<f64>,
    rpm_limit: Option<i32>,
    concurrency_limit: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct RangeQuery {
    range: Option<String>,
}

#[async_trait]
impl<S> FromRequestParts<S> for SaasContext
where
    Arc<AppState>: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = (StatusCode, &'static str);

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let app_state = Arc::from_ref(state);
        let token = cookie_value(&parts.headers, SESSION_COOKIE)
            .ok_or((StatusCode::UNAUTHORIZED, "SaaS session required"))?;
        let token_hash = hash_token(&token);
        let session: (String,) = sqlx::query_as(
            "SELECT user_id FROM saas_sessions
             WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP",
        )
        .bind(token_hash)
        .fetch_optional(&app_state.db)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?
        .ok_or((StatusCode::UNAUTHORIZED, "SaaS session expired"))?;

        let user = sqlx::query_as::<_, SaasUser>(
            "SELECT id, email, password_hash, status FROM saas_users WHERE id = $1 AND status = 'active'",
        )
        .bind(&session.0)
        .fetch_optional(&app_state.db)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?
        .ok_or((StatusCode::UNAUTHORIZED, "SaaS account is disabled"))?;

        let membership: (String, String) = sqlx::query_as(
            "SELECT om.org_id, p.id FROM org_memberships om
             JOIN projects p ON p.org_id = om.org_id
             WHERE om.user_id = $1 ORDER BY om.created_at ASC LIMIT 1",
        )
        .bind(&user.id)
        .fetch_optional(&app_state.db)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?
        .ok_or((StatusCode::FORBIDDEN, "SaaS workspace is not configured"))?;

        Ok(SaasContext {
            user,
            org_id: membership.0,
            project_id: membership.1,
        })
    }
}

pub fn routes(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/auth/register", post(register))
        .route("/auth/login", post(login))
        .route("/auth/logout", post(logout))
        .route("/auth/me", get(me))
        .route(
            "/model-services",
            get(list_model_services).post(create_model_service),
        )
        .route("/model-catalog", get(list_model_catalog))
        .route(
            "/model-services/:id/endpoints",
            post(add_model_service_endpoint),
        )
        .route(
            "/model-services/:id/endpoints/:endpoint_id",
            delete(delete_model_service_endpoint),
        )
        .route(
            "/model-services/:id",
            get(get_model_service).delete(delete_model_service),
        )
        .route("/api-keys", get(list_api_keys).post(create_api_key))
        .route(
            "/api-keys/:id",
            patch(update_api_key).delete(revoke_api_key),
        )
        .route("/usage", get(get_usage))
        .route("/savings", get(get_savings))
        .with_state(state)
}

async fn register(
    State(state): State<Arc<AppState>>,
    Json(input): Json<RegisterRequest>,
) -> Result<Response, (StatusCode, Json<ApiResponse<()>>)> {
    let email = normalize_email(&input.email);
    validate_credentials(&email, &input.password)?;
    let password_hash = hash_password(&input.password);
    let user_id = Uuid::new_v4().to_string();
    let org_id = Uuid::new_v4().to_string();
    let project_id = Uuid::new_v4().to_string();

    let mut tx = state.db.begin().await.map_err(db_error)?;
    sqlx::query("INSERT INTO saas_users (id, email, password_hash) VALUES ($1, $2, $3)")
        .bind(&user_id)
        .bind(&email)
        .bind(password_hash)
        .execute(&mut *tx)
        .await
        .map_err(|_| conflict_error("Email is already registered"))?;
    sqlx::query("INSERT INTO orgs (id, name, description) VALUES ($1, $2, $3)")
        .bind(&org_id)
        .bind(format!("{}'s workspace", email))
        .bind("Personal SmartGate workspace")
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    sqlx::query("INSERT INTO projects (id, org_id, name, description) VALUES ($1, $2, $3, $4)")
        .bind(&project_id)
        .bind(&org_id)
        .bind("Personal project")
        .bind("Default personal project")
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    sqlx::query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'owner')")
        .bind(&org_id)
        .bind(&user_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;

    let token = create_session(&state.db, &user_id)
        .await
        .map_err(db_error)?;
    Ok(session_response(
        json!({"email": email, "workspace": "Personal workspace"}),
        token,
        StatusCode::CREATED,
    ))
}

async fn login(
    State(state): State<Arc<AppState>>,
    Json(input): Json<LoginRequest>,
) -> Result<Response, (StatusCode, Json<ApiResponse<()>>)> {
    let email = normalize_email(&input.email);
    let user = sqlx::query_as::<_, SaasUser>(
        "SELECT id, email, password_hash, status FROM saas_users WHERE email = $1",
    )
    .bind(&email)
    .fetch_optional(&state.db)
    .await
    .map_err(db_error)?
    .filter(|user| {
        user.status == "active" && verify_password(&input.password, &user.password_hash)
    });
    let Some(user) = user else {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(ApiResponse::error("Invalid email or password")),
        ));
    };
    sqlx::query("UPDATE saas_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1")
        .bind(&user.id)
        .execute(&state.db)
        .await
        .map_err(db_error)?;
    let token = create_session(&state.db, &user.id)
        .await
        .map_err(db_error)?;
    Ok(session_response(
        json!({"email": user.email, "workspace": "Personal workspace"}),
        token,
        StatusCode::OK,
    ))
}

async fn logout(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
) -> Result<Response, (StatusCode, Json<ApiResponse<()>>)> {
    if let Some(token) = cookie_value(&headers, SESSION_COOKIE) {
        sqlx::query(
            "UPDATE saas_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = $1",
        )
        .bind(hash_token(&token))
        .execute(&state.db)
        .await
        .map_err(db_error)?;
    }
    let mut response = Json(ApiResponse::success(json!({"logged_out": true}))).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_static("smartgate_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax"),
    );
    Ok(response)
}

async fn me(ctx: SaasContext) -> Json<ApiResponse<Value>> {
    Json(ApiResponse::success(json!({
        "id": ctx.user.id,
        "email": ctx.user.email,
        "org_id": ctx.org_id,
        "project_id": ctx.project_id,
    })))
}

async fn list_model_catalog(_ctx: SaasContext) -> Json<ApiResponse<Value>> {
    let mut offerings = Vec::new();
    let mut grouped: BTreeMap<String, (String, Vec<Value>)> = BTreeMap::new();

    for offering in eero_llm_providers::list_offerings()
        .into_iter()
        .filter(|offering| offering.model.deprecated_at.is_none())
    {
        let provider_id = offering.provider_id.to_string();
        let provider_name = eero_llm_providers::get_providers_data()
            .get(offering.provider_id)
            .map(|provider| provider.label)
            .unwrap_or(offering.provider_id)
            .to_string();
        let model = json!({
            "provider_id": offering.provider_id,
            "provider_name": provider_name,
            "endpoint_id": offering.endpoint_id,
            "endpoint_key": offering.endpoint_key,
            "region": offering.region,
            "base_url": offering.base_url,
            "price_currency": offering.price_currency,
            "model": offering.model.id,
            "model_name": offering.model.name,
            "description": offering.model.description,
            "input_price_per_1m": offering.model.input_price,
            "output_price_per_1m": offering.model.output_price,
            "supports_tools": offering.model.supports_tools,
            "supports_vision": offering.model.supports_vision,
            "supports_reasoning": offering.model.supports_reasoning,
            "context_length": offering.model.context_length,
        });
        offerings.push(model.clone());
        grouped
            .entry(provider_id)
            .or_insert_with(|| (provider_name, Vec::new()))
            .1
            .push(model);
    }

    let providers = grouped
        .into_iter()
        .map(|(id, (name, models))| {
            json!({
                "id": id,
                "name": name,
                "model_count": models.len(),
                "models": models,
            })
        })
        .collect::<Vec<_>>();

    Json(ApiResponse::success(json!({
        "providers": providers,
        // Keep the flat form for existing clients while the UI uses the grouped form.
        "offerings": offerings,
        "registry_version": eero_llm_providers::registry_version(),
        "registry_updated_at": eero_llm_providers::registry_updated_at(),
    })))
}

async fn create_model_service(
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

    let has_explicit_endpoints = !input.endpoints.is_empty();
    let endpoints = if has_explicit_endpoints {
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
                    provider_type,
                    base_url,
                    api_key,
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
        if endpoint.provider_type.trim().is_empty()
            || endpoint.base_url.trim().is_empty()
            || endpoint.api_key.trim().is_empty()
            || endpoint.upstream_model_id.trim().is_empty()
        {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ApiResponse::error(
                    "Every upstream endpoint needs a provider, URL, API key, and model",
                )),
            ));
        }
        if !endpoint.base_url.starts_with("https://")
            && !endpoint.base_url.starts_with("http://127.0.0.1")
        {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ApiResponse::error("Provider URL must use HTTPS")),
            ));
        }
    }

    let service_id = Uuid::new_v4().to_string();
    let pool_id = Uuid::new_v4().to_string();
    let model_id = Uuid::new_v4().to_string();
    let public_model = format!("{}-{}", ctx.user.id, input.name);
    let strategy = input.strategy.unwrap_or_else(|| "cost_aware".to_string());
    let mut tx = state.db.begin().await.map_err(db_error)?;
    let mut provider_types = Vec::with_capacity(endpoints.len());

    sqlx::query("INSERT INTO model_pools (id, org_id, name, strategy) VALUES ($1, $2, $3, $4)")
        .bind(&pool_id)
        .bind(&ctx.org_id)
        .bind(&input.name)
        .bind(&strategy)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;

    for (index, endpoint) in endpoints.iter().enumerate() {
        let provider_id = Uuid::new_v4().to_string();
        let endpoint_id = Uuid::new_v4().to_string();
        provider_types.push(endpoint.provider_type.clone());
        sqlx::query("INSERT INTO provider_accounts (id, org_id, name, provider_type, base_url, api_key) VALUES ($1, $2, $3, $4, $5, $6)")
            .bind(&provider_id)
            .bind(&ctx.org_id)
            .bind(format!("saas-{service_id}-{}", index + 1))
            .bind(&endpoint.provider_type)
            .bind(&endpoint.base_url)
            .bind(&endpoint.api_key)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        sqlx::query("INSERT INTO endpoints (id, account_id, name, upstream_model_id, input_price_per_1m, output_price_per_1m, capability_score, supports_tools, context_length) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)")
            .bind(&endpoint_id)
            .bind(&provider_id)
            .bind(format!("{}-{}", input.name, index + 1))
            .bind(&endpoint.upstream_model_id)
            .bind(endpoint.input_price_per_1m.unwrap_or(0.0))
            .bind(endpoint.output_price_per_1m.unwrap_or(0.0))
            .bind(endpoint.capability_score.unwrap_or(0.5).clamp(0.0, 1.0))
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
        "name": input.name,
        "model": public_model,
        "provider_type": if provider_types.len() > 1 { "mixed".to_string() } else { provider_types.first().cloned().unwrap_or_else(|| "not_configured".to_string()) },
        "provider_types": provider_types,
        "endpoint_count": endpoints.len(),
        "strategy": strategy,
        "status": if endpoints.is_empty() { "draft" } else { "active" }
    }))))
}

async fn get_model_service(
    State(state): State<Arc<AppState>>,
    ctx: SaasContext,
    Path(model_id): Path<String>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    let service: Option<(String, String, String, String)> = sqlx::query_as(
        "SELECT vm.id, vm.name, mp.name, mp.strategy
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
    let Some((id, public_model, name, strategy)) = service else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ApiResponse::error("Model service not found")),
        ));
    };
    let endpoints: Vec<(
        String,
        String,
        String,
        String,
        String,
        f64,
        f64,
        f64,
        Option<i32>,
    )> = sqlx::query_as(
        "SELECT e.id, pa.name, pa.provider_type, e.upstream_model_id, pa.base_url,
                    e.input_price_per_1m, e.output_price_per_1m, e.capability_score,
                    e.context_length
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
        .map(|endpoint| endpoint.2.clone())
        .collect::<Vec<_>>();
    let endpoint_values = endpoints
        .into_iter()
        .map(
            |(
                endpoint_id,
                provider_name,
                provider_type,
                model,
                base_url,
                input_price,
                output_price,
                capability,
                context_length,
            )| {
                json!({
                    "id": endpoint_id,
                    "provider_name": provider_name,
                    "provider_type": provider_type,
                    "model": model,
                    "base_url": base_url,
                    "input_price_per_1m": input_price,
                    "output_price_per_1m": output_price,
                    "capability_score": capability,
                    "context_length": context_length,
                })
            },
        )
        .collect::<Vec<_>>();
    let endpoint_count = endpoint_values.len();
    Ok(Json(ApiResponse::success(json!({
        "id": id,
        "name": name,
        "model": public_model,
        "strategy": strategy,
        "provider_type": if provider_types.len() > 1 { "mixed" } else { provider_types.first().map(String::as_str).unwrap_or("not_configured") },
        "provider_types": provider_types,
        "endpoint_count": endpoint_count,
        "endpoints": endpoint_values,
        "status": if endpoint_count == 0 { "draft" } else { "active" },
    }))))
}

async fn add_model_service_endpoint(
    State(state): State<Arc<AppState>>,
    ctx: SaasContext,
    Path(model_id): Path<String>,
    Json(endpoint): Json<ModelEndpointRequest>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    if endpoint.provider_type.trim().is_empty()
        || endpoint.base_url.trim().is_empty()
        || endpoint.api_key.trim().is_empty()
        || endpoint.upstream_model_id.trim().is_empty()
    {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error(
                "Provider, URL, API key, and model are required",
            )),
        ));
    }
    if !endpoint.base_url.starts_with("https://")
        && !endpoint.base_url.starts_with("http://127.0.0.1")
    {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error("Provider URL must use HTTPS")),
        ));
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
    let Some((pool_id, endpoint_count)) = pool else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ApiResponse::error("Model service not found")),
        ));
    };
    let mut tx = state.db.begin().await.map_err(db_error)?;
    let provider_id = Uuid::new_v4().to_string();
    let endpoint_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO provider_accounts (id, org_id, name, provider_type, base_url, api_key) VALUES ($1, $2, $3, $4, $5, $6)")
        .bind(&provider_id)
        .bind(&ctx.org_id)
        .bind(format!("saas-{model_id}-{}", endpoint_count + 1))
        .bind(&endpoint.provider_type)
        .bind(&endpoint.base_url)
        .bind(&endpoint.api_key)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    sqlx::query("INSERT INTO endpoints (id, account_id, name, upstream_model_id, input_price_per_1m, output_price_per_1m, capability_score, supports_tools, context_length) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)")
        .bind(&endpoint_id)
        .bind(&provider_id)
        .bind(format!("model-service-{}", endpoint_count + 1))
        .bind(&endpoint.upstream_model_id)
        .bind(endpoint.input_price_per_1m.unwrap_or(0.0))
        .bind(endpoint.output_price_per_1m.unwrap_or(0.0))
        .bind(endpoint.capability_score.unwrap_or(0.5).clamp(0.0, 1.0))
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
    tx.commit().await.map_err(db_error)?;
    sync(&state).await;
    Ok(Json(ApiResponse::success(json!({
        "id": endpoint_id,
        "provider_type": endpoint.provider_type,
        "model": endpoint.upstream_model_id,
        "endpoint_count": endpoint_count + 1,
    }))))
}

async fn list_model_services(
    State(state): State<Arc<AppState>>,
    ctx: SaasContext,
) -> Result<Json<ApiResponse<Vec<Value>>>, (StatusCode, Json<ApiResponse<()>>)> {
    let rows: Vec<(String, String, String, String, Option<String>, Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
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

    let mut services: Vec<(
        String,
        String,
        String,
        String,
        Vec<String>,
        Vec<String>,
        Vec<String>,
    )> = Vec::new();
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
                    "model": service.1,
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

async fn delete_model_service_endpoint(
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

async fn delete_model_service(
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
        sqlx::query("DELETE FROM provider_accounts WHERE id = $1")
            .bind(account_id)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
    }
    tx.commit().await.map_err(db_error)?;
    sync(&state).await;
    Ok(Json(ApiResponse::success(json!({"deleted": true}))))
}

async fn list_api_keys(
    State(state): State<Arc<AppState>>,
    ctx: SaasContext,
) -> Result<Json<ApiResponse<Vec<Value>>>, (StatusCode, Json<ApiResponse<()>>)> {
    let rows: Vec<(String, String, String, bool, Option<i32>, Option<i32>, Option<f64>, Option<chrono::DateTime<Utc>>, chrono::DateTime<Utc>)> = sqlx::query_as(
        "SELECT id, name, key_prefix, enabled, rpm_limit, concurrency_limit, daily_spend_limit, last_used_at, created_at FROM api_keys WHERE project_id = $1 ORDER BY created_at DESC",
    ).bind(&ctx.project_id).fetch_all(&state.db).await.map_err(db_error)?;
    Ok(Json(ApiResponse::success(rows.into_iter().map(|r| json!({
        "id": r.0, "name": r.1, "prefix": r.2, "enabled": r.3, "rpm_limit": r.4,
        "concurrency_limit": r.5, "daily_spend_limit": r.6, "last_used_at": r.7, "created_at": r.8
    })).collect())))
}

async fn create_api_key(
    State(state): State<Arc<AppState>>,
    ctx: SaasContext,
    Json(input): Json<CreateSaasKeyRequest>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    if input.name.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error("Key name is required")),
        ));
    }
    let id = Uuid::new_v4().to_string();
    let raw = format!("pk_{}", Uuid::new_v4().simple());
    let prefix = raw[..7].to_string();
    sqlx::query("INSERT INTO api_keys (id, project_id, name, key_hash, key_prefix, rpm_limit, concurrency_limit, daily_spend_limit) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)")
        .bind(&id).bind(&ctx.project_id).bind(&input.name).bind(hash_token(&raw)).bind(&prefix)
        .bind(input.rpm_limit).bind(input.concurrency_limit).bind(input.daily_spend_limit)
        .execute(&state.db).await.map_err(db_error)?;
    Ok(Json(ApiResponse::success(
        json!({"id": id, "name": input.name, "key": raw, "prefix": prefix}),
    )))
}

async fn update_api_key(
    State(state): State<Arc<AppState>>,
    ctx: SaasContext,
    Path(key_id): Path<String>,
    Json(input): Json<CreateSaasKeyRequest>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    let result = sqlx::query("UPDATE api_keys SET name = $1, rpm_limit = $2, concurrency_limit = $3, daily_spend_limit = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 AND project_id = $6")
        .bind(input.name).bind(input.rpm_limit).bind(input.concurrency_limit).bind(input.daily_spend_limit).bind(key_id).bind(ctx.project_id).execute(&state.db).await.map_err(db_error)?;
    if result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ApiResponse::error("API key not found")),
        ));
    }
    Ok(Json(ApiResponse::success(json!({"updated": true}))))
}

async fn revoke_api_key(
    State(state): State<Arc<AppState>>,
    ctx: SaasContext,
    Path(key_id): Path<String>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    let result = sqlx::query("UPDATE api_keys SET enabled = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND project_id = $2").bind(key_id).bind(ctx.project_id).execute(&state.db).await.map_err(db_error)?;
    if result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ApiResponse::error("API key not found")),
        ));
    }
    Ok(Json(ApiResponse::success(json!({"revoked": true}))))
}

async fn get_usage(
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
    let sql = format!("SELECT COUNT(*), COALESCE(SUM(u.prompt_tokens),0), COALESCE(SUM(u.completion_tokens),0), COALESCE(SUM(u.total_tokens),0), COALESCE(SUM(u.estimated_cost),0), COALESCE(AVG(u.latency_ms)::double precision, 0.0), COALESCE(SUM(CASE WHEN u.status_code >= 200 AND u.status_code < 300 THEN 1 ELSE 0 END),0), COALESCE(SUM(u.trimmed_chars),0) FROM usage_logs u JOIN projects p ON p.id = u.project_id WHERE p.org_id = $1 {where_sql}");
    let row: (i64, i64, i64, i64, f64, f64, i64, i64) = if let Some(value) = since_value {
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
                COALESCE(SUM(CASE WHEN u.usage_source = 'provider_reported' THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN u.pricing_source <> 'unpriced' THEN 1 ELSE 0 END), 0)
         FROM usage_logs u
         LEFT JOIN endpoints e ON e.id = u.endpoint_id
         LEFT JOIN provider_accounts pa ON pa.id = u.provider_account_id
         JOIN projects p ON p.id = u.project_id
         WHERE p.org_id = $1 {where_sql}
         GROUP BY pa.provider_type, e.upstream_model_id",
    );
    let breakdown_rows: Vec<(String, String, i64, i64, i64, i64, f64, i64, i64)> =
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

    let mut provider_groups: BTreeMap<String, (i64, i64, i64, i64, f64)> = BTreeMap::new();
    let mut model_groups: BTreeMap<(String, String), (i64, i64, i64, i64, f64)> = BTreeMap::new();
    let mut provider_reported_requests = 0_i64;
    let mut priced_requests = 0_i64;
    for (provider, model, requests, prompt, completion, total, cost, reported, priced) in
        breakdown_rows
    {
        let provider_entry = provider_groups.entry(provider.clone()).or_default();
        provider_entry.0 += requests;
        provider_entry.1 += prompt;
        provider_entry.2 += completion;
        provider_entry.3 += total;
        provider_entry.4 += cost;
        let model_entry = model_groups.entry((provider, model)).or_default();
        model_entry.0 += requests;
        model_entry.1 += prompt;
        model_entry.2 += completion;
        model_entry.3 += total;
        model_entry.4 += cost;
        provider_reported_requests += reported;
        priced_requests += priced;
    }
    let provider_breakdown = provider_groups
        .into_iter()
        .map(|(provider, (requests, prompt, completion, total, cost))| {
            json!({"provider": provider, "requests": requests, "prompt_tokens": prompt, "completion_tokens": completion, "total_tokens": total, "estimated_spend": cost})
        })
        .collect::<Vec<_>>();
    let model_breakdown = model_groups
        .into_iter()
        .map(|((provider, model), (requests, prompt, completion, total, cost))| {
            json!({"model": model, "provider": provider, "requests": requests, "prompt_tokens": prompt, "completion_tokens": completion, "total_tokens": total, "estimated_spend": cost})
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
    let mut data_quality = Vec::new();
    if usage_coverage < 1.0 {
        data_quality.push("Some requests did not include provider-reported token usage; those records use local estimates or are unavailable.");
    }
    if pricing_coverage < 1.0 {
        data_quality.push(
            "Some models do not have configured pricing, so estimated spend may be incomplete.",
        );
    }
    Ok(Json(ApiResponse::success(
        json!({"range": range, "requests": row.0, "prompt_tokens": row.1, "completion_tokens": row.2, "total_tokens": row.3, "estimated_spend": row.4, "average_latency_ms": row.5, "success_rate": success_rate, "trimmed_chars": row.7, "budget": {"spent_today": spent_today, "daily_limit": daily_limit, "remaining_today": remaining, "status": match evaluate_budget(spent_today, daily_limit) { BudgetOutcome::Ok => "ok", BudgetOutcome::Soft { .. } => "soft", BudgetOutcome::Hard { .. } => "hard" }}, "coverage": {"usage": usage_coverage, "pricing": pricing_coverage, "provider_reported_requests": provider_reported_requests, "priced_requests": priced_requests}, "data_quality": data_quality, "breakdowns": {"providers": provider_breakdown, "models": model_breakdown}}),
    )))
}

async fn get_savings(
    State(state): State<Arc<AppState>>,
    ctx: SaasContext,
    Query(query): Query<RangeQuery>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    let usage = get_usage(State(state.clone()), ctx.clone(), Query(query)).await?;
    let data = usage.0.data.unwrap_or(Value::Null);
    let estimated_spend = data.get("estimated_spend").cloned().unwrap_or(json!(0));
    let trimmed_chars = data.get("trimmed_chars").cloned().unwrap_or(json!(0));
    Ok(Json(ApiResponse::success(
        json!({"estimated_spend": estimated_spend, "estimated_savings": Value::Null, "trimmed_chars": trimmed_chars, "basis": "A reliable dollar baseline requires a configured comparison endpoint; current savings signals are usage reduction and cost-aware routing.", "is_estimated": true}),
    )))
}

fn range_since(
    range: &str,
) -> Result<Option<chrono::DateTime<Utc>>, (StatusCode, Json<ApiResponse<()>>)> {
    match range {
        "24h" => Ok(Some(Utc::now() - Duration::hours(24))),
        "7d" => Ok(Some(Utc::now() - Duration::days(7))),
        "30d" => Ok(Some(Utc::now() - Duration::days(30))),
        "all" => Ok(None),
        _ => Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error(
                "range must be one of: 24h, 7d, 30d, all",
            )),
        )),
    }
}

fn cookie_value(headers: &axum::http::HeaderMap, name: &str) -> Option<String> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .find_map(|part| {
            let (key, value) = part.trim().split_once('=')?;
            (key == name).then(|| value.to_string())
        })
}

fn normalize_email(email: &str) -> String {
    email.trim().to_ascii_lowercase()
}

fn validate_credentials(
    email: &str,
    password: &str,
) -> Result<(), (StatusCode, Json<ApiResponse<()>>)> {
    if !email.contains('@') || email.len() > 254 || password.len() < 10 || password.len() > 256 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error(
                "Use a valid email and a password of 10-256 characters",
            )),
        ));
    }
    Ok(())
}

fn hash_password(password: &str) -> String {
    let salt = Uuid::new_v4().simple().to_string();
    format!("sha256${}${}", salt, password_digest(password, &salt))
}

fn verify_password(password: &str, stored: &str) -> bool {
    let mut parts = stored.split('$');
    matches!((parts.next(), parts.next(), parts.next()), (Some("sha256"), Some(salt), Some(digest)) if password_digest(password, salt) == digest)
}

fn password_digest(password: &str, salt: &str) -> String {
    hash_token(&format!("smartgate-password-v1:{salt}:{password}"))
}

async fn create_session(db: &PgPool, user_id: &str) -> Result<String, sqlx::Error> {
    let token = format!("sgs_{}", Uuid::new_v4().simple());
    sqlx::query(
        "INSERT INTO saas_sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(user_id)
    .bind(hash_token(&token))
    .bind(Utc::now() + Duration::days(SESSION_DAYS))
    .execute(db)
    .await?;
    Ok(token)
}

fn session_response(data: Value, token: String, status: StatusCode) -> Response {
    let mut response = (status, Json(ApiResponse::success(data))).into_response();
    let secure = std::env::var("COOKIE_SECURE")
        .map(|value| value != "0")
        .unwrap_or(false);
    let cookie = format!(
        "{SESSION_COOKIE}={token}; Max-Age={}; Path=/; HttpOnly; SameSite=Lax{}",
        SESSION_DAYS * 24 * 60 * 60,
        if secure { "; Secure" } else { "" }
    );
    if let Ok(value) = HeaderValue::from_str(&cookie) {
        response.headers_mut().insert(header::SET_COOKIE, value);
    }
    response
}

async fn sync(state: &Arc<AppState>) {
    let _ = crate::sync::sync_all_pools(
        &state.engine,
        &state.db,
        &state.pools,
        &state.pool_members,
        &state.profiles,
    )
    .await;
}

fn db_error<E>(_error: E) -> (StatusCode, Json<ApiResponse<()>>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ApiResponse::error("Database error")),
    )
}
fn conflict_error(message: &str) -> (StatusCode, Json<ApiResponse<()>>) {
    (StatusCode::CONFLICT, Json(ApiResponse::error(message)))
}
