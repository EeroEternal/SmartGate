//! SaaS control-plane API: authentication, model services, API keys, and usage analytics.
//!
//! Shared types, the session extractor, and cross-module helpers live here;
//! feature handlers are split into focused child modules.

mod analytics;
mod api_keys;
mod auth;
mod model_services;
pub mod openrouter;
pub mod providers;

use axum::{
    async_trait,
    extract::{FromRef, FromRequestParts},
    http::{header, request::Parts, StatusCode},
    routing::{get, patch, post},
    Json, Router,
};
use chrono::{Duration, Utc};
use serde::Deserialize;
use sqlx::FromRow;
use std::sync::Arc;

use crate::{
    api::models::ApiResponse,
    auth::hash_token,
    config::AppState,
    routing::canonicalize_strategy,
};

const SESSION_COOKIE: &str = "smartgate_session";

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

#[derive(Debug, Deserialize)]
struct RangeQuery {
    range: Option<String>,
}

pub fn routes(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/auth/register", post(auth::register))
        .route(
            "/auth/send-verification-code",
            post(auth::send_verification_code),
        )
        .route("/auth/login", post(auth::login))
        .route("/auth/logout", post(auth::logout))
        .route("/auth/me", get(auth::me).patch(auth::update_profile))
        .route(
            "/model-services",
            get(model_services::list_model_services).post(model_services::create_model_service),
        )
        .route("/model-catalog", get(model_services::list_model_catalog))
        .route(
            "/model-services/:id/endpoints",
            post(model_services::add_model_service_endpoint),
        )
        .route(
            "/model-services/:id/endpoints/:endpoint_id",
            patch(model_services::update_model_service_endpoint)
                .post(model_services::test_model_service_endpoint)
                .delete(model_services::delete_model_service_endpoint),
        )
        .route(
            "/model-services/:id/endpoints/:endpoint_id/probe",
            post(model_services::probe_model_service_endpoint),
        )
        .route(
            "/test-connection",
            post(model_services::test_connection),
        )
        .route(
            "/model-services/:id",
            get(model_services::get_model_service)
                .patch(model_services::update_model_service)
                .delete(model_services::delete_model_service),
        )
        .route(
            "/api-keys",
            get(api_keys::list_api_keys).post(api_keys::create_api_key),
        )
        .route("/api-keys/:id/profile", get(api_keys::get_api_key_profile))
        .route(
            "/api-keys/:id",
            patch(api_keys::update_api_key).delete(api_keys::delete_api_key),
        )
        .route("/api-keys/:id/revoke", post(api_keys::revoke_api_key))
        .route("/usage", get(analytics::get_usage))
        .route("/analytics/routing", get(analytics::get_routing_analytics))
        .route("/analytics/quality", get(analytics::get_quality_analytics))
        .route("/savings", get(analytics::get_savings))
        .route(
            "/savings-baseline",
            get(analytics::get_savings_baseline).patch(analytics::update_savings_baseline),
        )
        .route("/openrouter/market", get(openrouter::get_openrouter_market))
        .route("/openrouter/sync", post(openrouter::trigger_openrouter_sync))
        .route(
            "/providers",
            get(providers::list_providers).post(providers::create_provider),
        )
        .route(
            "/providers/:id",
            patch(providers::update_provider).delete(providers::delete_provider),
        )
        .with_state(state)
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

const SAAS_STRATEGIES: &[&str] = &[
    "cost_aware",
    "capability_aware",
    "load_aware",
    "round_robin",
];

fn saas_strategy(raw: &str) -> Result<String, (StatusCode, Json<ApiResponse<()>>)> {
    let canonical = canonicalize_strategy(raw.trim());
    if SAAS_STRATEGIES.contains(&canonical) {
        Ok(canonical.to_string())
    } else {
        Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error("Unsupported routing strategy")),
        ))
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

async fn sync(state: &Arc<AppState>) {
    let _ = crate::sync::sync_all_pools(
        &state.engine,
        &state.db,
        &state.pools,
        &state.pool_members,
        &state.profiles,
        &state.metrics,
    )
    .await;
}

fn db_error<E: std::fmt::Display>(error: E) -> (StatusCode, Json<ApiResponse<()>>) {
    let message = format!("Database error: {error}");
    tracing::error!("SaaS {message}");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ApiResponse::error(&message)),
    )
}

fn conflict_error(message: &str) -> (StatusCode, Json<ApiResponse<()>>) {
    (StatusCode::CONFLICT, Json(ApiResponse::error(message)))
}

fn is_unique_violation(error: &sqlx::Error) -> bool {
    matches!(error, sqlx::Error::Database(database_error) if database_error.code().as_deref() == Some("23505"))
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;

    use super::{range_since, saas_strategy};

    #[test]
    fn api_key_profile_range_windows_are_supported() {
        assert!(range_since("24h").unwrap().is_some());
        assert!(range_since("7d").unwrap().is_some());
        assert!(range_since("30d").unwrap().is_some());
        assert!(range_since("all").unwrap().is_none());
    }

    #[test]
    fn api_key_profile_rejects_unknown_range() {
        let error = range_since("90d").expect_err("unknown range must fail");
        assert_eq!(error.0, StatusCode::BAD_REQUEST);
    }

    #[test]
    fn saas_strategy_accepts_canonical_and_alias_names() {
        assert_eq!(saas_strategy("cost_aware").unwrap(), "cost_aware");
        assert_eq!(saas_strategy("capability").unwrap(), "capability_aware");
        assert_eq!(saas_strategy("lowest_price").unwrap(), "cost_aware");
        assert_eq!(saas_strategy("round_robin").unwrap(), "round_robin");
        assert!(saas_strategy("priority").is_err());
        assert!(saas_strategy("").is_err());
    }
}
