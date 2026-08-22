//! Shadow Flighting: asynchronously mirror a small sample of live traffic to a
//! configured flagship model and record the result for quality agreement analysis.

use crate::auth::{resolve_authorized_virtual_model, AuthContext};
use crate::config::AppState;
use crate::routing::canonicalize_strategy;
use crate::warm::{parse_context_with_headers, strip_context, Delivery};
use axum::body::to_bytes;
use axum::http::{HeaderMap, StatusCode};
use std::sync::Arc;
use unigateway_sdk::host::{HostContext, HostDispatchOutcome, HostDispatchTarget, HostProtocol, HostRequest, dispatch_request_with_middleware};

use super::host::SmartGatePoolHost;

const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
const PREVIEW_CHARS: usize = 500;

/// Execute a shadow request to `shadow_model_name` using the same prompt as the
/// original request. Returns the shadow response preview, latency, status, and
/// endpoint/provider metadata. Errors are logged but not propagated because
/// shadow flighting must not affect the user-facing request.
pub async fn execute_shadow(
    state: Arc<AppState>,
    auth: AuthContext,
    headers: HeaderMap,
    mut payload: serde_json::Value,
    shadow_model_name: String,
    request_preview: String,
    is_openai: bool,
) -> Option<ShadowResult> {
    let start = std::time::Instant::now();

    let shadow_virtual_model = match resolve_authorized_virtual_model(
        &state.db,
        &shadow_model_name,
        &auth.project.id,
        &auth.api_key.id,
    )
    .await
    {
        Ok(Some(vm)) => vm,
        Ok(None) => {
            tracing::warn!("Shadow model {} is not authorized for this key", shadow_model_name);
            return None;
        }
        Err(error) => {
            tracing::error!("Shadow virtual model resolution failed: {}", error);
            return None;
        }
    };

    // Strip warming context from the shadow payload so it does not reuse session state.
    if let Ok(Some(context)) = parse_context_with_headers(&payload, Some(&headers)) {
        if context.delivery == Delivery::Full {
            strip_context(&mut payload);
        }
    }

    // Replace the model field with the shadow service name.
    if let Some(obj) = payload.as_object_mut() {
        obj.insert("model".to_string(), serde_json::Value::String(shadow_model_name));
    }

    let protocol = if is_openai {
        unigateway_sdk::protocol::openai_payload_to_chat_request(&payload, &shadow_virtual_model.name)
    } else {
        unigateway_sdk::protocol::anthropic_payload_to_chat_request(&payload, &shadow_virtual_model.name)
    };

    let mut proxy_request = match protocol {
        Ok(req) => req,
        Err(error) => {
            tracing::warn!("Shadow request parse failed: {}", error);
            return None;
        }
    };

    proxy_request
        .metadata
        .insert("org_id".to_string(), auth.project.org_id.clone());
    proxy_request
        .metadata
        .insert("project_id".to_string(), auth.project.id.clone());
    proxy_request
        .metadata
        .insert("key_id".to_string(), auth.api_key.id.clone());
    proxy_request
        .metadata
        .insert("virtual_model_id".to_string(), shadow_virtual_model.id.clone());
    proxy_request
        .metadata
        .insert("pool_id".to_string(), shadow_virtual_model.pool_id.clone());
    proxy_request.metadata.insert(
        "routing_strategy".to_string(),
        canonicalize_strategy("round_robin").to_string(),
    );

    let pool_host = SmartGatePoolHost {
        engine: state.engine.as_ref(),
    };
    let host_context = HostContext::from_parts(state.engine.as_ref(), &pool_host);
    let request = HostRequest::Chat(proxy_request);
    let host_protocol = if is_openai {
        HostProtocol::OpenAiChat
    } else {
        HostProtocol::AnthropicMessages
    };

    let dispatch = dispatch_request_with_middleware(
        &host_context,
        HostDispatchTarget::Service(&shadow_virtual_model.pool_id),
        host_protocol,
        None,
        request,
        None,
    )
    .await;

    let latency_ms = start.elapsed().as_millis() as i32;
    let (status_code, response_preview, provider_type, endpoint_id) = match dispatch {
        Ok(HostDispatchOutcome::Response(response)) => {
            let (status, body) = response.into_parts();
            let status = status.as_u16() as i32;
            let preview = match body {
                unigateway_sdk::protocol::ProtocolResponseBody::Json(json) => extract_json_preview(&json),
                unigateway_sdk::protocol::ProtocolResponseBody::ServerSentEvents(_) => String::from("[stream]"),
            };
            let provider_type = "unknown".to_string();
            let endpoint_id = String::new();
            (status, preview, provider_type, endpoint_id)
        }
        Ok(HostDispatchOutcome::PoolNotFound) => {
            tracing::warn!("Shadow pool not found");
            return None;
        }
        Ok(_) => {
            tracing::warn!("Unsupported shadow dispatch outcome");
            return None;
        }
        Err(error) => {
            tracing::warn!("Shadow dispatch error: {}", error);
            return None;
        }
    };

    Some(ShadowResult {
        virtual_model_id: shadow_virtual_model.id,
        endpoint_id,
        provider_type,
        latency_ms,
        status_code,
        request_preview,
        response_preview,
    })
}

pub struct ShadowResult {
    pub virtual_model_id: String,
    pub endpoint_id: String,
    pub provider_type: String,
    pub latency_ms: i32,
    pub status_code: i32,
    pub request_preview: String,
    pub response_preview: String,
}

pub fn extract_response_preview(body: &[u8]) -> String {
    let text = String::from_utf8_lossy(body);
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
        extract_json_preview(&value)
    } else {
        let content = text.to_string();
        if content.len() > PREVIEW_CHARS {
            content.chars().take(PREVIEW_CHARS).collect()
        } else {
            content
        }
    }
}

pub fn extract_json_preview(value: &serde_json::Value) -> String {
    let content = value
        .get("choices")
        .and_then(|choices| choices.as_array())
        .and_then(|arr| arr.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(|content| content.as_str())
        .unwrap_or("")
        .to_string();
    if content.len() > PREVIEW_CHARS {
        content.chars().take(PREVIEW_CHARS).collect()
    } else {
        content
    }
}

/// Persist a shadow evaluation record.
pub async fn store_shadow_evaluation(
    db: &sqlx::PgPool,
    org_id: &str,
    project_id: &str,
    key_id: &str,
    result: &ShadowResult,
    similarity_score: f64,
    agreement: bool,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO shadow_evaluations
         (id, org_id, project_id, key_id, timestamp, virtual_model_id, endpoint_id,
          provider_type, latency_ms, status_code, request_preview, response_preview,
          similarity_score, agreement, estimated_cost)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5, $6, $7, $8, $9, $10, $11, $12, $13, 0)",
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(org_id)
    .bind(project_id)
    .bind(key_id)
    .bind(&result.virtual_model_id)
    .bind(&result.endpoint_id)
    .bind(&result.provider_type)
    .bind(result.latency_ms)
    .bind(result.status_code)
    .bind(&result.request_preview)
    .bind(&result.response_preview)
    .bind(similarity_score)
    .bind(if agreement { 1 } else { 0 })
    .execute(db)
    .await?;
    Ok(())
}
