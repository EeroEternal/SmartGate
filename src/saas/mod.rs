use axum::{
    async_trait,
    extract::{FromRef, FromRequestParts, Path, Query, State},
    http::{header, request::Parts, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, patch, post},
    Json, Router,
};
use chrono::{Duration, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{FromRow, PgPool};
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use unigateway_sdk::core::{EndpointRef, ExecutionPlan, ExecutionTarget, RetryPolicy};
use uuid::Uuid;

use crate::{
    api::models::ApiResponse,
    auth::hash_token,
    config::AppState,
    policy::{evaluate_budget, BudgetOutcome},
};

const SESSION_COOKIE: &str = "smartgate_session";
const SESSION_DAYS: i64 = 30;
const VERIFICATION_CODE_TTL_MINUTES: i64 = 10;
const VERIFICATION_RESEND_SECONDS: i64 = 60;
const VERIFICATION_MAX_ATTEMPTS: i32 = 5;

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
    verification_code: String,
}

#[derive(Debug, Deserialize)]
struct VerificationCodeRequest {
    email: String,
}

#[derive(Debug, Deserialize)]
struct LoginRequest {
    email: String,
    password: String,
}

#[derive(Debug, Deserialize, Clone)]
struct ModelEndpointRequest {
    provider_type: String,
    #[serde(default)]
    provider_name: Option<String>,
    #[serde(default)]
    protocol: Option<String>,
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
struct UpdateModelEndpointRequest {
    provider_name: String,
    provider_type: String,
    protocol: String,
    base_url: String,
    #[serde(default)]
    api_key: Option<String>,
    upstream_model_id: String,
    input_price_per_1m: Option<f64>,
    output_price_per_1m: Option<f64>,
    capability_score: Option<f64>,
    supports_tools: Option<bool>,
    context_length: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct CreateSaasKeyRequest {
    name: String,
    #[serde(default)]
    model_service_ids: Vec<String>,
    daily_spend_limit: Option<f64>,
    rpm_limit: Option<i32>,
    concurrency_limit: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct RangeQuery {
    range: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SavingsBaselineRequest {
    virtual_model_id: String,
    endpoint_id: String,
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
        .route("/auth/send-verification-code", post(send_verification_code))
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
            patch(update_model_service_endpoint)
                .post(test_model_service_endpoint)
                .delete(delete_model_service_endpoint),
        )
        .route(
            "/model-services/:id",
            get(get_model_service).delete(delete_model_service),
        )
        .route("/api-keys", get(list_api_keys).post(create_api_key))
        .route(
            "/api-keys/:id",
            patch(update_api_key).delete(delete_api_key),
        )
        .route("/api-keys/:id/revoke", post(revoke_api_key))
        .route("/usage", get(get_usage))
        .route("/savings", get(get_savings))
        .route(
            "/savings-baseline",
            get(get_savings_baseline).patch(update_savings_baseline),
        )
        .with_state(state)
}

async fn register(
    State(state): State<Arc<AppState>>,
    Json(input): Json<RegisterRequest>,
) -> Result<Response, (StatusCode, Json<ApiResponse<()>>)> {
    let email = normalize_email(&input.email);
    validate_credentials(&email, &input.password)?;
    validate_verification_code(&input.verification_code)?;
    let password_hash = hash_password(&input.password);
    let user_id = Uuid::new_v4().to_string();
    let org_id = Uuid::new_v4().to_string();
    let project_id = Uuid::new_v4().to_string();

    let mut tx = state.db.begin().await.map_err(db_error)?;
    let verification: Option<(String, i32, chrono::DateTime<Utc>, Option<chrono::DateTime<Utc>>)> =
        sqlx::query_as(
            "SELECT code_hash, attempts, expires_at, used_at
             FROM saas_email_verifications WHERE email = $1 FOR UPDATE",
        )
        .bind(&email)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_error)?;
    let Some((code_hash, attempts, expires_at, used_at)) = verification else {
        return Err(verification_error("Request a verification code first"));
    };
    if used_at.is_some() || expires_at <= Utc::now() || attempts >= VERIFICATION_MAX_ATTEMPTS {
        return Err(verification_error("The verification code is invalid or expired"));
    }
    if code_hash != verification_code_hash(&email, &input.verification_code) {
        sqlx::query("UPDATE saas_email_verifications SET attempts = attempts + 1 WHERE email = $1")
            .bind(&email)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        return Err(verification_error("The verification code is invalid or expired"));
    }
    sqlx::query("UPDATE saas_email_verifications SET used_at = CURRENT_TIMESTAMP WHERE email = $1")
        .bind(&email)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    sqlx::query("INSERT INTO saas_users (id, email, password_hash) VALUES ($1, $2, $3)")
        .bind(&user_id)
        .bind(&email)
        .bind(password_hash)
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            if let sqlx::Error::Database(database_error) = &error {
                if database_error.constraint() == Some("saas_users_email_key") {
                    return conflict_error("Email is already registered");
                }
            }
            db_error(error)
        })?;
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

async fn send_verification_code(
    State(state): State<Arc<AppState>>,
    Json(input): Json<VerificationCodeRequest>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    let email = normalize_email(&input.email);
    validate_email(&email)?;

    let already_registered: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM saas_users WHERE email = $1",
    )
    .bind(&email)
    .fetch_optional(&state.db)
    .await
    .map_err(db_error)?;
    if already_registered.is_some() {
        return Ok(Json(ApiResponse::success(json!({"sent": true}))));
    }

    let recent: Option<(chrono::DateTime<Utc>,)> = sqlx::query_as(
        "SELECT sent_at FROM saas_email_verifications
         WHERE email = $1 AND used_at IS NULL",
    )
    .bind(&email)
    .fetch_optional(&state.db)
    .await
    .map_err(db_error)?;
    if let Some((sent_at,)) = recent {
        let elapsed = (Utc::now() - sent_at).num_seconds();
        if elapsed < VERIFICATION_RESEND_SECONDS {
            return Err((
                StatusCode::TOO_MANY_REQUESTS,
                Json(ApiResponse::error("Please wait before requesting another code")),
            ));
        }
    }

    let (Some(api_key), Some(from_email)) = (
        state.config.resend_api_key.as_deref(),
        state.config.resend_from_email.as_deref(),
    ) else {
        tracing::error!("Email verification is not configured");
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ApiResponse::error("Email verification is not configured")),
        ));
    };

    let code = format!("{:06}", (Uuid::new_v4().as_u128() % 1_000_000) as u32);
    let response = reqwest::Client::new()
        .post("https://api.resend.com/emails")
        .bearer_auth(api_key)
        .json(&json!({
            "from": from_email,
            "to": [email],
            "subject": "Your SmartGate verification code",
            "html": format!("<p>Your SmartGate verification code is <strong>{code}</strong>.</p><p>This code expires in {VERIFICATION_CODE_TTL_MINUTES} minutes.</p>"),
        }))
        .send()
        .await
        .map_err(|error| {
            tracing::error!(error = %error, "Failed to send verification email");
            email_service_error()
        })?;
    if !response.status().is_success() {
        tracing::error!(status = %response.status(), "Resend rejected verification email");
        return Err(email_service_error());
    }

    sqlx::query(
        "INSERT INTO saas_email_verifications (email, code_hash, attempts, sent_at, expires_at, used_at)
         VALUES ($1, $2, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + ($3 * INTERVAL '1 minute'), NULL)
         ON CONFLICT (email) DO UPDATE SET code_hash = EXCLUDED.code_hash,
           attempts = 0, sent_at = EXCLUDED.sent_at, expires_at = EXCLUDED.expires_at, used_at = NULL",
    )
    .bind(&email)
    .bind(verification_code_hash(&email, &code))
    .bind(VERIFICATION_CODE_TTL_MINUTES)
    .execute(&state.db)
    .await
    .map_err(db_error)?;

    Ok(Json(ApiResponse::success(json!({"sent": true}))))
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
                    provider_name: None,
                    protocol: None,
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
        let protocol = endpoint.protocol.as_deref().unwrap_or("openai");
        if !matches!(protocol, "openai" | "anthropic") {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ApiResponse::error("Protocol must be OpenAI or Anthropic")),
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
    let strategy = input.strategy.unwrap_or_else(|| "cost_aware".to_string());
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
        let provider_id = Uuid::new_v4().to_string();
        let endpoint_id = Uuid::new_v4().to_string();
        provider_types.push(endpoint.provider_type.clone());
        let protocol = endpoint.protocol.as_deref().unwrap_or("openai");
        sqlx::query("INSERT INTO provider_accounts (id, org_id, name, provider_type, protocol, base_url, api_key) VALUES ($1, $2, $3, $4, $5, $6, $7)")
            .bind(&provider_id)
            .bind(&ctx.org_id)
            .bind(endpoint.provider_name.clone().unwrap_or_else(|| endpoint.provider_type.clone()))
            .bind(&endpoint.provider_type)
            .bind(protocol)
            .bind(&endpoint.base_url)
            .bind(&endpoint.api_key)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        sqlx::query("INSERT INTO endpoints (id, account_id, name, upstream_model_id, input_price_per_1m, output_price_per_1m, capability_score, supports_tools, context_length) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)")
            .bind(&endpoint_id)
            .bind(&provider_id)
            .bind(format!("{}-{}", service_name, index + 1))
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
        "name": service_name,
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
    let Some((id, _legacy_model, name, strategy)) = service else {
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
        String,
        String,
        f64,
        f64,
        f64,
        Option<i32>,
    )> = sqlx::query_as(
        "SELECT e.id, pa.id, CASE WHEN pa.name LIKE 'saas-%' THEN pa.provider_type ELSE pa.name END, pa.provider_type, pa.protocol, e.upstream_model_id, pa.base_url,
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
        .map(|endpoint| endpoint.3.clone())
        .collect::<Vec<_>>();
    let endpoint_values = endpoints
        .into_iter()
        .map(
            |(
                endpoint_id,
                provider_id,
                provider_name,
                provider_type,
                protocol,
                model,
                base_url,
                input_price,
                output_price,
                capability,
                context_length,
            )| {
                json!({
                    "id": endpoint_id,
                    "provider_id": provider_id,
                    "provider_name": provider_name,
                    "provider_type": provider_type,
                    "protocol": protocol,
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
        "model": name,
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
    let protocol = endpoint.protocol.as_deref().unwrap_or("openai");
    if !matches!(protocol, "openai" | "anthropic") {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error("Protocol must be OpenAI or Anthropic")),
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
    sqlx::query("INSERT INTO provider_accounts (id, org_id, name, provider_type, protocol, base_url, api_key) VALUES ($1, $2, $3, $4, $5, $6, $7)")
        .bind(&provider_id)
        .bind(&ctx.org_id)
        .bind(endpoint.provider_name.clone().unwrap_or_else(|| endpoint.provider_type.clone()))
        .bind(&endpoint.provider_type)
        .bind(endpoint.protocol.as_deref().unwrap_or("openai"))
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

async fn update_model_service_endpoint(
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
    sqlx::query("UPDATE provider_accounts SET name = $1, provider_type = $2, protocol = $3, base_url = $4, api_key = COALESCE($5, api_key), updated_at = CURRENT_TIMESTAMP WHERE id = $6")
        .bind(provider_name).bind(provider_type).bind(&protocol).bind(base_url)
        .bind(input.api_key.as_deref().filter(|key| !key.trim().is_empty())).bind(&account_id)
        .execute(&state.db).await.map_err(db_error)?;
    sqlx::query("UPDATE endpoints SET upstream_model_id = $1, input_price_per_1m = $2, output_price_per_1m = $3, capability_score = $4, supports_tools = COALESCE($5, supports_tools), context_length = $6, updated_at = CURRENT_TIMESTAMP WHERE id = $7")
        .bind(model).bind(input.input_price_per_1m.unwrap_or(0.0)).bind(input.output_price_per_1m.unwrap_or(0.0))
        .bind(input.capability_score.unwrap_or(0.5).clamp(0.0, 1.0))
        .bind(input.supports_tools.map(|value| if value { 1 } else { 0 })).bind(input.context_length).bind(&endpoint_id)
        .execute(&state.db).await.map_err(db_error)?;
    sync(&state).await;
    Ok(Json(ApiResponse::success(
        json!({"id": endpoint_id, "updated": true}),
    )))
}

async fn test_model_service_endpoint(
    State(state): State<Arc<AppState>>,
    ctx: SaasContext,
    Path((model_id, endpoint_id)): Path<(String, String)>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    let target: Option<(String, String, String)> = sqlx::query_as(
        "SELECT mp.id, pa.protocol, e.upstream_model_id FROM endpoints e
         JOIN model_pool_endpoints mpe ON mpe.endpoint_id = e.id
         JOIN model_pools mp ON mp.id = mpe.pool_id
         JOIN provider_accounts pa ON pa.id = e.account_id
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
    let Some((pool_id, protocol, upstream_model_id)) = target else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ApiResponse::error("Model endpoint not found")),
        ));
    };
    let payload = json!({"model": upstream_model_id, "max_tokens": 8, "messages": [{"role": "user", "content": "Say OK"}]});
    let request = if protocol.eq_ignore_ascii_case("anthropic") {
        unigateway_sdk::protocol::anthropic_payload_to_chat_request(&payload, &upstream_model_id)
    } else {
        unigateway_sdk::protocol::openai_payload_to_chat_request(&payload, &upstream_model_id)
    }
    .map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error("Could not build provider test request")),
        )
    })?;
    let target = ExecutionTarget::Plan(ExecutionPlan {
        pool_id: Some(pool_id),
        candidates: vec![EndpointRef { endpoint_id }],
        load_balancing_override: None,
        retry_policy_override: Some(RetryPolicy::default()),
        metadata: HashMap::new(),
    });
    match state.engine.proxy_chat(request, target).await {
        Ok(_) => Ok(Json(ApiResponse::success(
            json!({"passed": true, "message": "Connection successful"}),
        ))),
        Err(_) => Err((
            StatusCode::BAD_GATEWAY,
            Json(ApiResponse::error(
                "Connection failed. Check the provider URL, model, and API key.",
            )),
        )),
    }
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

async fn create_api_key(
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
    let prefix = raw[..7].to_string();
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

async fn update_api_key(
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

async fn revoke_api_key(
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

async fn delete_api_key(
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
                COALESCE(SUM(CASE WHEN u.pricing_source <> 'unpriced' THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN u.usage_source <> 'provider_reported' THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN u.usage_source = 'local_estimate' THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN u.usage_source = 'unavailable' THEN 1 ELSE 0 END), 0)
         FROM usage_logs u
         LEFT JOIN endpoints e ON e.id = u.endpoint_id
         LEFT JOIN provider_accounts pa ON pa.id = u.provider_account_id
         JOIN projects p ON p.id = u.project_id
         WHERE p.org_id = $1 {where_sql}
         GROUP BY pa.provider_type, e.upstream_model_id",
    );
    let breakdown_rows: Vec<(String, String, i64, i64, i64, i64, f64, i64, i64, i64, i64, i64)> =
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
    let mut missing_usage_groups: BTreeMap<(String, String), (i64, i64, i64)> = BTreeMap::new();
    for (
        provider,
        model,
        requests,
        prompt,
        completion,
        total,
        cost,
        reported,
        priced,
        missing,
        local_estimate,
        unavailable,
    ) in breakdown_rows
    {
        let provider_entry = provider_groups.entry(provider.clone()).or_default();
        provider_entry.0 += requests;
        provider_entry.1 += prompt;
        provider_entry.2 += completion;
        provider_entry.3 += total;
        provider_entry.4 += cost;
        let model_entry = model_groups
            .entry((provider.clone(), model.clone()))
            .or_default();
        model_entry.0 += requests;
        model_entry.1 += prompt;
        model_entry.2 += completion;
        model_entry.3 += total;
        model_entry.4 += cost;
        provider_reported_requests += reported;
        priced_requests += priced;
        if missing > 0 {
            missing_usage_groups
                .entry((provider, model))
                .and_modify(|entry| {
                    entry.0 += missing;
                    entry.1 += local_estimate;
                    entry.2 += unavailable;
                })
                .or_insert((missing, local_estimate, unavailable));
        }
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
    let missing_usage_requests = row.0 - provider_reported_requests;
    let missing_usage_breakdown = missing_usage_groups
        .into_iter()
        .map(|((provider, model), (missing, local_estimate, unavailable))| {
            json!({
                "provider": provider,
                "model": model,
                "requests": missing,
                "local_estimate_requests": local_estimate,
                "unavailable_requests": unavailable,
            })
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
        json!({"range": range, "requests": row.0, "prompt_tokens": row.1, "completion_tokens": row.2, "total_tokens": row.3, "estimated_spend": row.4, "average_latency_ms": row.5, "success_rate": success_rate, "trimmed_chars": row.7, "budget": {"spent_today": spent_today, "daily_limit": daily_limit, "remaining_today": remaining, "status": match evaluate_budget(spent_today, daily_limit) { BudgetOutcome::Ok => "ok", BudgetOutcome::Soft { .. } => "soft", BudgetOutcome::Hard { .. } => "hard" }}, "coverage": {"usage": usage_coverage, "pricing": pricing_coverage, "provider_reported_requests": provider_reported_requests, "priced_requests": priced_requests, "missing_usage_requests": missing_usage_requests, "missing_usage_breakdown": missing_usage_breakdown}, "data_quality": data_quality, "breakdowns": {"providers": provider_breakdown, "models": model_breakdown}}),
    )))
}

async fn get_savings_baseline(
    State(state): State<Arc<AppState>>,
    ctx: SaasContext,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    let baseline = sqlx::query_as::<_, (String, String, String, String, String, f64, f64)>(
        "SELECT sb.virtual_model_id, sb.endpoint_id, vm.name, e.upstream_model_id,
                pa.name, e.input_price_per_1m, e.output_price_per_1m
         FROM savings_baselines sb
         JOIN virtual_models vm ON vm.id = sb.virtual_model_id
         JOIN model_pools mp ON mp.id = vm.pool_id
         JOIN project_model_grants g ON g.virtual_model_id = vm.id AND g.project_id = sb.project_id
         JOIN model_pool_endpoints mpe ON mpe.pool_id = mp.id
         JOIN endpoints e ON e.id = mpe.endpoint_id
         JOIN provider_accounts pa ON pa.id = e.account_id
         WHERE sb.project_id = $1 AND mp.org_id = $2 AND mpe.endpoint_id = sb.endpoint_id",
    )
    .bind(&ctx.project_id)
    .bind(&ctx.org_id)
    .fetch_optional(&state.db)
    .await
    .map_err(db_error)?;

    let Some((virtual_model_id, endpoint_id, service_name, model, provider_name, input_price, output_price)) = baseline else {
        return Ok(Json(ApiResponse::success(json!({"configured": false}))));
    };
    Ok(Json(ApiResponse::success(json!({
        "configured": true,
        "virtual_model_id": virtual_model_id,
        "endpoint_id": endpoint_id,
        "model_service_name": service_name,
        "model": model,
        "provider_name": provider_name,
        "input_price_per_1m": input_price,
        "output_price_per_1m": output_price,
    }))))
}

async fn update_savings_baseline(
    State(state): State<Arc<AppState>>,
    ctx: SaasContext,
    Json(input): Json<SavingsBaselineRequest>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    let valid: Option<(String,)> = sqlx::query_as(
        "SELECT e.id
         FROM virtual_models vm
         JOIN model_pools mp ON mp.id = vm.pool_id
         JOIN project_model_grants g ON g.virtual_model_id = vm.id AND g.project_id = $4
         JOIN model_pool_endpoints mpe ON mpe.pool_id = mp.id
         JOIN endpoints e ON e.id = mpe.endpoint_id
         WHERE vm.id = $1 AND e.id = $2 AND mp.org_id = $3",
    )
    .bind(&input.virtual_model_id)
    .bind(&input.endpoint_id)
    .bind(&ctx.org_id)
    .bind(&ctx.project_id)
    .fetch_optional(&state.db)
    .await
    .map_err(db_error)?;
    if valid.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error("The selected model endpoint is not available to this project")),
        ));
    }

    sqlx::query(
        "INSERT INTO savings_baselines (project_id, virtual_model_id, endpoint_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (project_id) DO UPDATE SET
           virtual_model_id = EXCLUDED.virtual_model_id,
           endpoint_id = EXCLUDED.endpoint_id,
           updated_at = CURRENT_TIMESTAMP",
    )
    .bind(&ctx.project_id)
    .bind(&input.virtual_model_id)
    .bind(&input.endpoint_id)
    .execute(&state.db)
    .await
    .map_err(db_error)?;

    Ok(Json(ApiResponse::success(json!({"updated": true}))))
}

async fn get_savings(
    State(state): State<Arc<AppState>>,
    ctx: SaasContext,
    Query(query): Query<RangeQuery>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    let range = query.range.as_deref().unwrap_or("24h");
    let since = range_since(range)?;
    let baseline = sqlx::query_as::<_, (String, String, String, String, String, f64, f64)>(
        "SELECT sb.virtual_model_id, sb.endpoint_id, vm.name, e.upstream_model_id,
                pa.name, e.input_price_per_1m, e.output_price_per_1m
         FROM savings_baselines sb
         JOIN virtual_models vm ON vm.id = sb.virtual_model_id
         JOIN model_pools mp ON mp.id = vm.pool_id
         JOIN project_model_grants g ON g.virtual_model_id = vm.id AND g.project_id = sb.project_id
         JOIN model_pool_endpoints mpe ON mpe.pool_id = mp.id
         JOIN endpoints e ON e.id = mpe.endpoint_id
         JOIN provider_accounts pa ON pa.id = e.account_id
         WHERE sb.project_id = $1 AND mp.org_id = $2 AND mpe.endpoint_id = sb.endpoint_id",
    )
    .bind(&ctx.project_id)
    .bind(&ctx.org_id)
    .fetch_optional(&state.db)
    .await
    .map_err(db_error)?;

    let Some((virtual_model_id, endpoint_id, service_name, model, provider_name, input_price, output_price)) = baseline else {
        return Ok(Json(ApiResponse::success(json!({
            "estimated_spend": Value::Null,
            "estimated_savings": Value::Null,
            "trimmed_chars": 0,
            "configured": false,
            "basis": "Configure a model service baseline to estimate dollar savings from context reduction and cost-aware routing.",
            "is_estimated": true,
        }))));
    };
    if input_price <= 0.0 && output_price <= 0.0 {
        return Ok(Json(ApiResponse::success(json!({
            "estimated_spend": Value::Null,
            "estimated_savings": Value::Null,
            "trimmed_chars": 0,
            "configured": true,
            "baseline": {"virtual_model_id": virtual_model_id, "endpoint_id": endpoint_id, "model_service_name": service_name, "model": model, "provider_name": provider_name, "input_price_per_1m": input_price, "output_price_per_1m": output_price},
            "basis": "Add input or output pricing to the selected model endpoint to estimate dollar savings.",
            "is_estimated": true,
        }))));
    }

    let (where_sql, since_value) = if since.is_some() {
        ("AND u.timestamp >= $3", since)
    } else {
        ("", None)
    };
    let sql = format!(
        "SELECT COALESCE(SUM(u.prompt_tokens), 0),
                COALESCE(SUM(u.completion_tokens), 0),
                COALESCE(SUM(u.trimmed_chars), 0),
                COALESCE(SUM(u.estimated_cost), 0)
         FROM usage_logs u JOIN projects p ON p.id = u.project_id
         WHERE p.org_id = $1 AND u.virtual_model_id = $2 {where_sql}"
    );
    let usage: (i64, i64, i64, f64) = if let Some(value) = since_value {
        sqlx::query_as(&sql)
            .bind(&ctx.org_id)
            .bind(&virtual_model_id)
            .bind(value)
            .fetch_one(&state.db)
            .await
    } else {
        sqlx::query_as(&sql)
            .bind(&ctx.org_id)
            .bind(&virtual_model_id)
            .fetch_one(&state.db)
            .await
    }
    .map_err(db_error)?;
    let (baseline_cost, estimated_savings) = calculate_savings(
        usage.0,
        usage.1,
        usage.2,
        usage.3,
        input_price,
        output_price,
    );

    Ok(Json(ApiResponse::success(json!({
        "estimated_spend": usage.3,
        "estimated_savings": estimated_savings,
        "baseline_cost": baseline_cost,
        "trimmed_chars": usage.2,
        "configured": true,
        "baseline": {"virtual_model_id": virtual_model_id, "endpoint_id": endpoint_id, "model_service_name": service_name, "model": model, "provider_name": provider_name, "input_price_per_1m": input_price, "output_price_per_1m": output_price},
        "basis": "Estimated against the selected model service endpoint using recorded tokens and restored trimmed context; actual provider billing may differ.",
        "is_estimated": true,
    }))))
}

fn calculate_savings(
    prompt_tokens: i64,
    completion_tokens: i64,
    trimmed_chars: i64,
    estimated_spend: f64,
    input_price_per_1m: f64,
    output_price_per_1m: f64,
) -> (f64, f64) {
    let restored_prompt_tokens = trimmed_chars as f64 / 4.0;
    let baseline_cost = ((prompt_tokens as f64 + restored_prompt_tokens) / 1_000_000.0)
        * input_price_per_1m
        + (completion_tokens as f64 / 1_000_000.0) * output_price_per_1m;
    (baseline_cost, baseline_cost - estimated_spend)
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

#[cfg(test)]
mod tests {
    use super::{calculate_savings, validate_verification_code, verification_code_hash};

    #[test]
    fn verification_code_hash_is_bound_to_email() {
        assert_eq!(
            verification_code_hash("user@example.com", "123456"),
            verification_code_hash("user@example.com", "123456")
        );
        assert_ne!(
            verification_code_hash("user@example.com", "123456"),
            verification_code_hash("other@example.com", "123456")
        );
    }

    #[test]
    fn verification_code_requires_six_digits() {
        assert!(validate_verification_code("123456").is_ok());
        assert!(validate_verification_code("12345").is_err());
        assert!(validate_verification_code("12345a").is_err());
    }

    #[test]
    fn savings_baseline_restores_trimmed_prompt_context() {
        let (baseline, savings) = calculate_savings(1_000_000, 100_000, 4_000, 1.0, 2.0, 3.0);
        assert!((baseline - 2.302).abs() < 1e-9);
        assert!((savings - 1.302).abs() < 1e-9);
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

fn validate_email(email: &str) -> Result<(), (StatusCode, Json<ApiResponse<()>>)> {
    let valid = email.len() <= 254
        && email.split_once('@').is_some_and(|(local, domain)| {
            !local.is_empty() && !domain.is_empty() && !domain.starts_with('.') && !domain.ends_with('.')
        });
    if !valid {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error("Use a valid email address")),
        ));
    }
    Ok(())
}

fn validate_credentials(
    email: &str,
    password: &str,
) -> Result<(), (StatusCode, Json<ApiResponse<()>>)> {
    validate_email(email)?;
    if password.len() < 10 || password.len() > 256 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error(
                "Use a valid email and a password of 10-256 characters",
            )),
        ));
    }
    Ok(())
}

fn validate_verification_code(
    code: &str,
) -> Result<(), (StatusCode, Json<ApiResponse<()>>)> {
    if code.len() != 6 || !code.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(verification_error("Enter the 6-digit verification code"));
    }
    Ok(())
}

fn verification_code_hash(email: &str, code: &str) -> String {
    hash_token(&format!("smartgate-email-verification-v1:{email}:{code}"))
}

fn verification_error(message: &str) -> (StatusCode, Json<ApiResponse<()>>) {
    (StatusCode::BAD_REQUEST, Json(ApiResponse::error(message)))
}

fn email_service_error() -> (StatusCode, Json<ApiResponse<()>>) {
    (
        StatusCode::BAD_GATEWAY,
        Json(ApiResponse::error("Unable to send the verification email")),
    )
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
