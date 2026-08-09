use axum::{
    async_trait,
    extract::{FromRef, FromRequestParts},
    http::{request::Parts, StatusCode, header::AUTHORIZATION},
};
use std::sync::Arc;
use crate::config::AppState;
use crate::models::{Project, ApiKey};

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
            return Err((StatusCode::UNAUTHORIZED, "Invalid Authorization header format"));
        }

        let token = &auth_header[7..];
        let token_hash = hash_token(token);

        let api_key = sqlx::query_as::<_, ApiKey>(
            "SELECT * FROM api_keys WHERE key_hash = $1 AND enabled = TRUE"
        )
        .bind(token_hash)
        .fetch_optional(&app_state.db)
        .await
        .map_err(|e| {
            tracing::error!("Auth database error: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Database error")
        })?
        .ok_or((StatusCode::UNAUTHORIZED, "Invalid or disabled API key"))?;

        let project = sqlx::query_as::<_, Project>(
            "SELECT * FROM projects WHERE id = $1"
        )
        .bind(&api_key.project_id)
        .fetch_one(&app_state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to resolve project: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to resolve project")
        })?;

        Ok(AuthContext { project, api_key })
    }
}

pub fn hash_token(token: &str) -> String {
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    hasher.update(token);
    hex::encode(hasher.finalize())
}
