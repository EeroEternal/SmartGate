use crate::auth::{resolve_authorized_virtual_model, AuthContext};
use crate::config::AppState;
use crate::warm::{PublishInput, SessionKey, WarmError};
use axum::{
    extract::{Json, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

#[derive(Debug, Deserialize)]
pub struct PublishRequest {
    pub epoch: i64,
    pub message_count: usize,
    pub messages: Vec<Value>,
    #[serde(default)]
    pub pinned_boundary: usize,
    pub prefix_hash: Option<String>,
    pub virtual_model: Option<String>,
}

pub async fn publish(
    State(state): State<Arc<AppState>>,
    auth: AuthContext,
    Path(session_id): Path<String>,
    Json(request): Json<PublishRequest>,
) -> Response {
    if session_id.is_empty() || session_id.len() > 256 {
        return warm_error(
            StatusCode::BAD_REQUEST,
            WarmError::InvalidContext(
                "session_id must be between 1 and 256 characters".to_string(),
            ),
        );
    }

    let key = SessionKey {
        project_id: auth.project.id.clone(),
        api_key_id: auth.api_key.id.clone(),
        session_id,
    };
    let virtual_model_id = match request.virtual_model.as_deref() {
        Some(requested_model)
            if requested_model.trim().is_empty() || requested_model.len() > 256 =>
        {
            return warm_error(
                StatusCode::BAD_REQUEST,
                WarmError::InvalidContext("virtual_model must be 1-256 characters".to_string()),
            )
        }
        Some(requested_model) => match resolve_authorized_virtual_model(
            &state.db,
            requested_model,
            &key.project_id,
            &key.api_key_id,
        )
        .await
        {
            Ok(Some(model)) => Some(model.id),
            Ok(None) => {
                return warm_error(StatusCode::FORBIDDEN, WarmError::VirtualModelUnauthorized)
            }
            Err(error) => {
                tracing::error!(error = %error, "failed to authorize Warm Virtual Model");
                return warm_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    WarmError::StoreUnavailable("failed to authorize Virtual Model".to_string()),
                );
            }
        },
        None if state.config.warm.require_virtual_model => {
            return warm_error(StatusCode::FORBIDDEN, WarmError::VirtualModelRequired)
        }
        None => None,
    };
    let input = PublishInput {
        epoch: request.epoch,
        message_count: request.message_count,
        messages: request.messages,
        pinned_boundary: request.pinned_boundary,
        prefix_hash: request.prefix_hash,
        virtual_model_id,
    };

    match state.warm_store.publish(key, input) {
        Ok(snapshot) => (
            StatusCode::OK,
            Json(json!({
                "ok": true,
                "epoch": snapshot.epoch,
                "message_count": snapshot.message_count,
                "prefix_hash": snapshot.prefix_hash,
                "hash_algorithm_version": crate::warm::HASH_ALGORITHM_VERSION,
            })),
        )
            .into_response(),
        Err(error) => {
            state.warm_store.record_publish_failure();
            warm_error(status_for(&error), error)
        }
    }
}

pub async fn metrics(State(state): State<Arc<AppState>>, _auth: AuthContext) -> Response {
    (StatusCode::OK, Json(state.warm_store.metrics().snapshot())).into_response()
}

pub async fn delete_session(
    State(state): State<Arc<AppState>>,
    auth: AuthContext,
    Path(session_id): Path<String>,
) -> Response {
    let key = SessionKey {
        project_id: auth.project.id,
        api_key_id: auth.api_key.id,
        session_id,
    };
    state.warm_store.delete(&key);
    StatusCode::NO_CONTENT.into_response()
}

fn status_for(error: &WarmError) -> StatusCode {
    match error {
        WarmError::InvalidContext(_) | WarmError::InvalidPublish(_) => StatusCode::BAD_REQUEST,
        WarmError::SessionNotFound | WarmError::SessionExpired => StatusCode::NOT_FOUND,
        WarmError::StoreUnavailable(_) => StatusCode::SERVICE_UNAVAILABLE,
        WarmError::PrefixTooLarge | WarmError::TailTooLarge | WarmError::AssembledTooLarge => {
            StatusCode::PAYLOAD_TOO_LARGE
        }
        WarmError::VirtualModelUnauthorized | WarmError::VirtualModelRequired => {
            StatusCode::FORBIDDEN
        }
        WarmError::EpochConflict
        | WarmError::StaleEpoch
        | WarmError::EpochMismatch
        | WarmError::PrefixHashMismatch
        | WarmError::TailStartMismatch { .. }
        | WarmError::VirtualModelMismatch => StatusCode::CONFLICT,
    }
}

pub fn warm_error(status: StatusCode, error: WarmError) -> Response {
    (
        status,
        Json(json!({
            "error": {
                "code": error.code(),
                "message": error.message(),
                "retryable": matches!(status, StatusCode::SERVICE_UNAVAILABLE),
            }
        })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;
    use crate::models::{ApiKey, Project};
    use axum::body::to_bytes;
    use axum::extract::{Json, Path, State};
    use chrono::Utc;
    use sqlx::postgres::PgPoolOptions;
    use std::net::SocketAddr;
    use unigateway_sdk::core::UniGatewayEngine;

    fn test_state() -> Arc<AppState> {
        let db = PgPoolOptions::new()
            .connect_lazy("postgres://warm-handler-test.invalid/smartgate")
            .expect("lazy pool should not connect");
        let engine = UniGatewayEngine::builder()
            .with_builtin_http_drivers()
            .build()
            .expect("test engine should build");
        Arc::new(AppState {
            config: Config {
                addr: "127.0.0.1:0".parse::<SocketAddr>().unwrap(),
                database_url: "postgres://warm-handler-test.invalid/smartgate".to_string(),
                admin_token: "test-admin-token".to_string(),
                cors_allowed_origins: vec![],
                resend_api_key: None,
                resend_from_email: None,
                warm: Default::default(),
            },
            db,
            metrics: Default::default(),
            pools: Default::default(),
            pool_members: Default::default(),
            profiles: Default::default(),
            quotas: Arc::new(crate::quota::QuotaLimiter::new()),
            hints: Default::default(),
            feedback: Arc::new(crate::routing::SmartGateFeedbackProvider {
                metrics: Default::default(),
                pools: Default::default(),
                pool_members: Default::default(),
                profiles: Default::default(),
                hints: Default::default(),
            }),
            engine: Arc::new(engine),
            warm_store: Arc::new(crate::warm::WarmStore::new()),
        })
    }

    fn test_auth() -> AuthContext {
        let now = Utc::now();
        AuthContext {
            project: Project {
                id: "project-test".to_string(),
                org_id: "org-test".to_string(),
                name: "test-project".to_string(),
                description: None,
                rpm_limit: None,
                concurrency_limit: None,
                daily_spend_limit: None,
                created_at: now,
                updated_at: now,
            },
            api_key: ApiKey {
                id: "key-test".to_string(),
                project_id: "project-test".to_string(),
                name: "test-key".to_string(),
                key_hash: "hash".to_string(),
                key_prefix: "sk-test".to_string(),
                enabled: true,
                metadata: None,
                rpm_limit: None,
                concurrency_limit: None,
                daily_spend_limit: None,
                last_used_at: None,
                created_at: now,
                updated_at: now,
            },
        }
    }

    fn request(epoch: i64, messages: Vec<Value>) -> PublishRequest {
        PublishRequest {
            epoch,
            message_count: messages.len(),
            messages,
            pinned_boundary: 0,
            prefix_hash: None,
            virtual_model: None,
        }
    }

    #[tokio::test]
    async fn publish_returns_snapshot_metadata() {
        let response = publish(
            State(test_state()),
            test_auth(),
            Path("session-test".to_string()),
            Json(request(1, vec![json!({"role": "system", "content": "hi"})])),
        )
        .await;

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let body: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["ok"], true);
        assert_eq!(body["epoch"], 1);
        assert_eq!(body["message_count"], 1);
        assert_eq!(
            body["hash_algorithm_version"],
            crate::warm::HASH_ALGORITHM_VERSION
        );
    }

    #[tokio::test]
    async fn conflicting_publish_returns_structured_conflict() {
        let state = test_state();
        let auth = test_auth();
        let session = "session-conflict".to_string();
        publish(
            State(state.clone()),
            auth.clone(),
            Path(session.clone()),
            Json(request(1, vec![json!({"content": "first"})])),
        )
        .await;

        let response = publish(
            State(state),
            auth,
            Path(session),
            Json(request(1, vec![json!({"content": "second"})])),
        )
        .await;

        assert_eq!(response.status(), StatusCode::CONFLICT);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let body: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["error"]["code"], "EPOCH_CONFLICT");
        assert_eq!(body["error"]["retryable"], false);
    }

    #[tokio::test]
    async fn invalid_session_id_is_bad_request() {
        let response = publish(
            State(test_state()),
            test_auth(),
            Path(String::new()),
            Json(request(1, vec![])),
        )
        .await;

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn delete_is_idempotent_and_returns_no_content() {
        let state = test_state();
        let auth = test_auth();
        let session = "session-delete".to_string();
        publish(
            State(state.clone()),
            auth.clone(),
            Path(session.clone()),
            Json(request(1, vec![json!({"content": "a"})])),
        )
        .await;

        let first = delete_session(State(state.clone()), auth.clone(), Path(session.clone())).await;
        let second = delete_session(State(state), auth, Path(session)).await;
        assert_eq!(first.status(), StatusCode::NO_CONTENT);
        assert_eq!(second.status(), StatusCode::NO_CONTENT);
    }
}
