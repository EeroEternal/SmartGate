//! SmartGate chat proxy: Control (auth/budget) → Cost slim → route hints → data plane.

use crate::auth::AuthContext;
use crate::config::AppState;
use crate::models::{ModelPool, VirtualModel};
use crate::policy::{
    effective_daily_limit, estimate_tokens_from_text, evaluate_budget, expected_output_tokens,
    extract_openai_prompt_text, heuristic_difficulty, request_has_tools, set_hint,
    slim_tool_messages, spent_today_for_key, tool_message_chars, BudgetOutcome, HintGuard,
    RouteHint, SlimConfig,
};
use crate::quota::{QuotaLimits, QuotaPermit};
use crate::routing::canonicalize_strategy;
use axum::{
    extract::{Json, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use std::sync::Arc;
use unigateway_sdk::core::pool::ExecutionTarget;

pub async fn chat_completions(
    State(state): State<Arc<AppState>>,
    auth: AuthContext,
    Json(mut payload): Json<serde_json::Value>,
) -> Response {
    let requested_model = payload
        .get("model")
        .and_then(|m| m.as_str())
        .unwrap_or("")
        .to_string();

    let virtual_model = match sqlx::query_as::<_, VirtualModel>(
        "SELECT vm.* FROM virtual_models vm 
         JOIN project_model_grants pmg ON vm.id = pmg.virtual_model_id
         WHERE vm.name = $1 AND pmg.project_id = $2 AND vm.enabled = TRUE",
    )
    .bind(&requested_model)
    .bind(&auth.project.id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(vm)) => vm,
        Ok(None) => {
            return (
                StatusCode::FORBIDDEN,
                "Access to this model is not granted or model not found",
            )
                .into_response()
        }
        Err(e) => {
            tracing::error!("Database error: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error").into_response();
        }
    };

    let pool = sqlx::query_as::<_, ModelPool>("SELECT * FROM model_pools WHERE id = $1")
        .bind(&virtual_model.pool_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();

    let strategy = pool
        .as_ref()
        .map(|p| canonicalize_strategy(&p.strategy).to_string())
        .unwrap_or_else(|| "round_robin".to_string());

    // --- Control: progressive spend budget ---
    let limit = effective_daily_limit(
        auth.api_key.daily_spend_limit,
        auth.project.daily_spend_limit,
    );
    let spent = spent_today_for_key(&state.db, &auth.api_key.id).await;
    let budget = evaluate_budget(spent, limit);
    if budget.is_blocked() {
        let headers = budget_headers(&budget, spent, limit);
        return (
            StatusCode::TOO_MANY_REQUESTS,
            headers,
            format!(
                "Daily spend budget exceeded (spent≈{spent:.4}, limit={limit:?}). Increase limit or wait until reset."
            ),
        )
            .into_response();
    }
    let downshift = budget.should_downshift();

    // --- Cost: context slim (message-structure tool aging; no session_id) ---
    let tool_chars_before = tool_message_chars(&payload);
    let mut slimmed_chars = 0usize;
    let mut tools_touched = 0usize;
    let mut slim_dry_run = true;
    if let Some(ref p) = pool {
        if p.tool_trim_enabled != 0 {
            let cfg = SlimConfig {
                keep_recent_full: 1,
                max_newest_chars: p.max_tool_chars.max(256) as usize,
                max_recent_chars: (p.max_tool_chars.max(256) as usize).min(4_000),
            };
            let result = slim_tool_messages(payload.clone(), &cfg);
            slimmed_chars = result.slimmed_chars;
            tools_touched = result.tools_touched;
            slim_dry_run = p.tool_trim_dry_run != 0;
            if !slim_dry_run && result.modified {
                payload = result.body;
            } else if result.modified {
                tracing::info!(
                    target: "smartgate.slim",
                    tool_chars_before,
                    slimmed_chars,
                    tools_touched,
                    dry_run = true,
                    "context slim dry-run"
                );
            }
        }
    }

    // Hints for Cost/Capability scoring (after slim so token est matches forwarded body)
    let prompt_text = extract_openai_prompt_text(&payload);
    let input_tokens = estimate_tokens_from_text(&prompt_text);
    let output_tokens = expected_output_tokens(&payload, 512);
    let difficulty = heuristic_difficulty(&payload);
    let has_tools = request_has_tools(&payload);

    set_hint(RouteHint {
        input_tokens,
        output_tokens,
        has_tools,
        difficulty,
        downshift,
        pool_id: virtual_model.pool_id.clone(),
    });
    let _hint_guard = HintGuard;

    let decision = serde_json::json!({
        "product": "smartgate",
        "strategy": strategy,
        "input_tokens_est": input_tokens,
        "output_tokens_est": output_tokens,
        "difficulty": difficulty,
        "has_tools": has_tools,
        "downshift": downshift,
        "spent_today": spent,
        "daily_limit": limit,
        "context_slim": {
            "tool_chars_before": tool_chars_before,
            "slimmed_chars": slimmed_chars,
            "tools_touched": tools_touched,
            "dry_run": slim_dry_run,
            "session_id_required": false,
        },
    });

    let key_limits = QuotaLimits {
        rpm_limit: auth.api_key.rpm_limit.map(|v| v as u32),
        concurrency_limit: auth.api_key.concurrency_limit.map(|v| v as u32),
    };
    let project_limits = QuotaLimits {
        rpm_limit: auth.project.rpm_limit.map(|v| v as u32),
        concurrency_limit: auth.project.concurrency_limit.map(|v| v as u32),
    };

    if let Err(reason) = state.quotas.try_acquire(
        &auth.api_key.id,
        &auth.project.id,
        &key_limits,
        &project_limits,
    ) {
        let mut headers = HeaderMap::new();
        if let Some(secs) = reason.retry_after_secs() {
            if let Ok(v) = HeaderValue::from_str(&secs.to_string()) {
                headers.insert("retry-after", v);
            }
        }
        return (StatusCode::TOO_MANY_REQUESTS, headers, reason.message()).into_response();
    }

    let permit = QuotaPermit::new(
        state.quotas.clone(),
        auth.api_key.id.clone(),
        auth.project.id.clone(),
    );

    let mut proxy_request = match unigateway_sdk::protocol::openai_payload_to_chat_request(
        &payload,
        &requested_model,
    ) {
        Ok(req) => req,
        Err(e) => {
            return (StatusCode::BAD_REQUEST, format!("Invalid request: {}", e)).into_response()
        }
    };

    proxy_request
        .metadata
        .insert("org_id".to_string(), auth.project.org_id);
    proxy_request
        .metadata
        .insert("project_id".to_string(), auth.project.id);
    proxy_request
        .metadata
        .insert("key_id".to_string(), auth.api_key.id);
    proxy_request
        .metadata
        .insert("virtual_model_id".to_string(), virtual_model.id);
    proxy_request
        .metadata
        .insert("pool_id".to_string(), virtual_model.pool_id.clone());
    proxy_request
        .metadata
        .insert("routing_strategy".to_string(), strategy);
    proxy_request
        .metadata
        .insert("routing_decision".to_string(), decision.to_string());
    proxy_request.metadata.insert(
        "tool_message_chars".to_string(),
        tool_chars_before.to_string(),
    );
    proxy_request
        .metadata
        .insert("trimmed_chars".to_string(), slimmed_chars.to_string());
    if downshift {
        proxy_request
            .metadata
            .insert("budget_downshift".to_string(), "1".to_string());
    }

    let target = ExecutionTarget::Pool {
        pool_id: virtual_model.pool_id,
    };

    match state.engine.proxy_chat(proxy_request, target).await {
        Ok(session) => {
            permit.disarm();
            let response = unigateway_sdk::protocol::render_openai_chat_session(session);
            let mut resp = protocol_response_to_axum(response);
            for (name, value) in budget_headers(&budget, spent, limit) {
                if let Some(name) = name {
                    resp.headers_mut().insert(name, value);
                }
            }
            if downshift {
                if let Ok(v) = HeaderValue::from_str("soft") {
                    resp.headers_mut().insert("x-smartgate-budget", v);
                }
            }
            if slimmed_chars > 0 {
                if let Ok(v) = HeaderValue::from_str(&slimmed_chars.to_string()) {
                    resp.headers_mut().insert("x-smartgate-slim-chars", v);
                }
            }
            resp
        }
        Err(e) => {
            tracing::error!("Proxy error: {}", e);
            (StatusCode::BAD_GATEWAY, format!("Upstream error: {}", e)).into_response()
        }
    }
}

fn budget_headers(budget: &BudgetOutcome, spent: f64, limit: Option<f64>) -> HeaderMap {
    let mut headers = HeaderMap::new();
    let status = match budget {
        BudgetOutcome::Ok => "ok",
        BudgetOutcome::Soft { .. } => "soft",
        BudgetOutcome::Hard { .. } => "hard",
    };
    headers.insert(
        "x-smartgate-budget-status",
        HeaderValue::from_static(status),
    );
    if let Some(limit) = limit.filter(|value| *value > 0.0) {
        if let Ok(value) = HeaderValue::from_str(&format!("{:.4}", spent / limit)) {
            headers.insert("x-smartgate-budget-used", value);
        }
        if let Ok(value) = HeaderValue::from_str(&format!("{:.4}", (limit - spent).max(0.0))) {
            headers.insert("x-smartgate-budget-remaining", value);
        }
    }
    headers
}

fn protocol_response_to_axum(resp: unigateway_sdk::protocol::ProtocolHttpResponse) -> Response {
    use axum::body::Body;
    use unigateway_sdk::protocol::ProtocolResponseBody;

    let (status, body) = resp.into_parts();
    match body {
        ProtocolResponseBody::Json(json) => (status, Json(json)).into_response(),
        ProtocolResponseBody::ServerSentEvents(stream) => {
            let body = Body::from_stream(stream);
            Response::builder()
                .status(status)
                .header("content-type", "text/event-stream")
                .header("cache-control", "no-cache")
                .header("connection", "keep-alive")
                .body(body)
                .unwrap()
        }
    }
}
