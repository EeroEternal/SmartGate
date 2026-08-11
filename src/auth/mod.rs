use crate::config::AppState;
use crate::models::{ApiKey, Project, VirtualModel};
use axum::{
    async_trait,
    extract::{FromRef, FromRequestParts},
    http::{header::AUTHORIZATION, request::Parts, StatusCode},
};
use sqlx::PgPool;
use std::sync::Arc;

pub mod admin;

#[derive(Debug, Clone)]
pub struct AuthContext {
    pub project: Project,
    pub api_key: ApiKey,
}

#[async_trait]
impl<S> FromRequestParts<S> for AuthContext
where
    Arc<AppState>: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = (StatusCode, &'static str);

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let app_state = Arc::from_ref(state);

        let auth_header = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|h| h.to_str().ok())
            .ok_or((StatusCode::UNAUTHORIZED, "Missing Authorization header"))?;

        if !auth_header.starts_with("Bearer ") {
            return Err((
                StatusCode::UNAUTHORIZED,
                "Invalid Authorization header format",
            ));
        }

        let token = &auth_header[7..];
        let token_hash = hash_token(token);

        let api_key = sqlx::query_as::<_, ApiKey>(
            "SELECT * FROM api_keys WHERE key_hash = $1 AND enabled = TRUE",
        )
        .bind(token_hash)
        .fetch_optional(&app_state.db)
        .await
        .map_err(|e| {
            tracing::error!("Auth database error: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Database error")
        })?
        .ok_or((StatusCode::UNAUTHORIZED, "Invalid or disabled API key"))?;

        let project = sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE id = $1")
            .bind(&api_key.project_id)
            .fetch_one(&app_state.db)
            .await
            .map_err(|e| {
                tracing::error!("Failed to resolve project: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to resolve project",
                )
            })?;

        Ok(AuthContext { project, api_key })
    }
}

pub async fn resolve_authorized_virtual_model(
    db: &PgPool,
    requested_model: &str,
    project_id: &str,
    api_key_id: &str,
) -> Result<Option<VirtualModel>, sqlx::Error> {
    sqlx::query_as::<_, VirtualModel>(
        "SELECT vm.* FROM virtual_models vm
         JOIN model_pools mp ON mp.id = vm.pool_id
         JOIN project_model_grants pmg ON vm.id = pmg.virtual_model_id
         WHERE (vm.id = $1 OR vm.name = $1 OR mp.name = $1)
           AND pmg.project_id = $2
           AND vm.enabled = TRUE
           AND (EXISTS (
                SELECT 1 FROM api_key_model_grants akmg
                WHERE akmg.api_key_id = $3 AND akmg.virtual_model_id = vm.id
           ) OR NOT EXISTS (
                SELECT 1 FROM api_key_model_grants akmg
                WHERE akmg.api_key_id = $3
           ))
         ORDER BY CASE
             WHEN vm.id = $1 THEN 0
             WHEN vm.name = $1 THEN 1
             ELSE 2
         END, vm.id
         LIMIT 1",
    )
    .bind(requested_model)
    .bind(project_id)
    .bind(api_key_id)
    .fetch_optional(db)
    .await
}

pub fn hash_token(token: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(token);
    hex::encode(hasher.finalize())
}
