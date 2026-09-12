//! SmartGate chat proxy: Control (auth/budget) → Cost slim → route hints → data plane.

use crate::api::shadow::{extract_json_preview, run_shadow, ShadowJob};
use crate::api::warm::warm_error;
use crate::auth::{resolve_authorized_virtual_model, AuthContext};
use crate::config::AppState;
use crate::models::{ModelPool, VirtualModel};
use crate::policy::{
    effective_daily_limit, estimate_tokens_from_text, evaluate_budget, expected_output_tokens,
    extract_complexity_signals, extract_context_epoch, extract_openai_prompt_text,
    extract_session_id, extract_user_prompt_preview, format_prefix_hash, get_sticky_endpoint,
    heuristic_difficulty, next_turn_index, prefix_stable, request_has_tools, resolve_prefix_hash,
    set_hint, slim_tool_messages, spent_today_for_key, tool_message_chars, BudgetOutcome,
    HintGuard, RouteHint, SlimConfig, JUDGE_TRIGGER_MAX, JUDGE_TRIGGER_MIN,
};
use crate::quota::{QuotaLimits, QuotaPermit};
use crate::routing::canonicalize_strategy;
use crate::warm::{
    install_session_gateway_context, parse_context_with_headers, strip_context, Delivery,
    SessionKey, WarmError,
};
use axum::{
    extract::{Json, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use std::sync::Arc;
use unigateway_sdk::core::ExecutionTarget;
use unigateway_sdk::host::HostError;

use super::host::SmartGatePoolHost;
use super::judge::{classify_with_judge, difficulty_tier, JudgeScope};

#[derive(Clone, Copy, PartialEq, Eq)]
enum ChatProtocol {
    OpenAi,
    Anthropic,
}

/// Unwraps a stage result, returning the prepared error response from the handler.
macro_rules! or_return {
    ($stage:expr) => {
        match $stage {
            Ok(value) => value,
            Err(response) => return response,
        }
    };
}

/// What the shadow stage needs to mirror a sampled request in the background.
struct ShadowRequest<'a> {
    state: &'a Arc<AppState>,
    auth: &'a AuthContext,
    headers: &'a HeaderMap,
    payload: &'a serde_json::Value,
    request_preview: &'a str,
    main_preview: &'a str,
    is_openai: bool,
}

/// Mirror one sampled request to the shadow model, or count a drop when no permit is
/// available. Best-effort by design: the user-facing response is never affected.
fn spawn_shadow(request: ShadowRequest<'_>, shadow_model_name: String) {
    match request.state.shadow_semaphore.clone().try_acquire_owned() {
        Ok(permit) => {
            let job = ShadowJob {
                state: Arc::clone(request.state),
                auth: request.auth.clone(),
                headers: request.headers.clone(),
                payload: request.payload.clone(),
                shadow_model_name,
                request_preview: request.request_preview.to_string(),
                main_preview: request.main_preview.to_string(),
                is_openai: request.is_openai,
            };
            tokio::spawn(async move {
                let _permit = permit;
                run_shadow(job).await;
            });
        }
        Err(_) => {
            metrics::counter!("shadow_dropped_total").increment(1);
        }
    }
}

/// Everything the data plane needs to know about the requested model service.
struct PoolContext {
    virtual_model: VirtualModel,
    pool: Option<ModelPool>,
    strategy: String,
}

/// Resolve the caller's model service, its pool and its canonical strategy.
///
/// Shared by every proxy surface so authorization and pool lookup cannot drift
/// between the chat completions, messages and responses entry points.
async fn resolve_pool_context(
    state: &AppState,
    auth: &AuthContext,
    requested_model: &str,
) -> Result<PoolContext, Response> {
    let virtual_model = match resolve_authorized_virtual_model(
        &state.db,
        requested_model,
        &auth.project.id,
        &auth.api_key.id,
    )
    .await
    {
        Ok(Some(model)) => model,
        Ok(None) => {
            return Err((
                StatusCode::FORBIDDEN,
                "Access to this model is not granted or model not found",
            )
                .into_response())
        }
        Err(error) => {
            tracing::error!("Database error: {}", error);
            return Err(
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error").into_response()
            );
        }
    };

    let pool = match sqlx::query_as::<_, ModelPool>("SELECT * FROM model_pools WHERE id = $1")
        .bind(&virtual_model.pool_id)
        .fetch_optional(&state.db)
        .await
    {
        Ok(pool) => pool,
        Err(error) => {
            tracing::error!("Database error: {}", error);
            return Err(
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error").into_response()
            );
        }
    };

    let strategy = pool
        .as_ref()
        .map(|pool| canonicalize_strategy(&pool.strategy).to_string())
        .unwrap_or_else(|| "round_robin".to_string());

    Ok(PoolContext {
        virtual_model,
        pool,
        strategy,
    })
}

/// Result of the progressive spend-budget stage.
struct BudgetGate {
    outcome: BudgetOutcome,
    spent: f64,
    limit: Option<f64>,
    downshift: bool,
}

/// Enforce the key/project daily spend budget, or answer 429 with the budget headers.
///
/// `include_detail` keeps the verbose body the chat proxy has always returned; the
/// responses surface has always used the short form.
async fn enforce_spend_budget(
    state: &AppState,
    auth: &AuthContext,
    include_detail: bool,
) -> Result<BudgetGate, Response> {
    let limit = effective_daily_limit(
        auth.api_key.daily_spend_limit,
        auth.project.daily_spend_limit,
    );
    let spent = match spent_today_for_key(&state.db, &auth.api_key.id).await {
        Ok(spent) => spent,
        Err(error) => {
            // Fail closed: without spend data we cannot enforce budgets.
            tracing::error!("Database error fetching spend for budget check: {}", error);
            return Err((
                StatusCode::SERVICE_UNAVAILABLE,
                "Spend tracking temporarily unavailable",
            )
                .into_response());
        }
    };
    let outcome = evaluate_budget(spent, limit);
    if outcome.is_blocked() {
        let headers = budget_headers(&outcome, spent, limit);
        let message = if include_detail {
            format!(
                "Daily spend budget exceeded (spent≈{spent:.4}, limit={limit:?}). Increase limit or wait until reset."
            )
        } else {
            "Daily spend budget exceeded".to_string()
        };
        return Err((StatusCode::TOO_MANY_REQUESTS, headers, message).into_response());
    }
    let downshift = outcome.should_downshift();
    Ok(BudgetGate {
        outcome,
        spent,
        limit,
        downshift,
    })
}

/// Reserve the request against the key and project rate/concurrency limits.
///
/// Called before any auxiliary dispatch so judge usage counts towards the same
/// admission decision, and the returned permit is held until the final response.
async fn acquire_quota(state: &AppState, auth: &AuthContext) -> Result<QuotaPermit, Response> {
    let key_limits = QuotaLimits {
        rpm_limit: auth.api_key.rpm_limit.map(|value| value as u32),
        concurrency_limit: auth.api_key.concurrency_limit.map(|value| value as u32),
    };
    let project_limits = QuotaLimits {
        rpm_limit: auth.project.rpm_limit.map(|value| value as u32),
        concurrency_limit: auth.project.concurrency_limit.map(|value| value as u32),
    };
    if let Err(reason) = state.quotas.try_acquire(
        &auth.api_key.id,
        &auth.project.id,
        &key_limits,
        &project_limits,
    ) {
        let mut headers = HeaderMap::new();
        if let Some(seconds) = reason.retry_after_secs() {
            if let Ok(value) = HeaderValue::from_str(&seconds.to_string()) {
                headers.insert("retry-after", value);
            }
        }
        return Err((StatusCode::TOO_MANY_REQUESTS, headers, reason.message()).into_response());
    }
    Ok(QuotaPermit::new(
        state.quotas.clone(),
        auth.api_key.id.clone(),
        auth.project.id.clone(),
    ))
}

/// Prompt-derived inputs shared by the routing hints and the recorded decision.
struct RequestSignals {
    prompt_text: String,
    input_tokens: u32,
    output_tokens: u32,
    difficulty: f64,
    has_tools: bool,
    signals: Vec<String>,
}

fn request_signals(payload: &serde_json::Value) -> RequestSignals {
    let prompt_text = extract_openai_prompt_text(payload);
    RequestSignals {
        input_tokens: estimate_tokens_from_text(&prompt_text),
        output_tokens: expected_output_tokens(payload, 512),
        difficulty: heuristic_difficulty(payload),
        has_tools: request_has_tools(payload),
        signals: extract_complexity_signals(payload),
        prompt_text,
    }
}

/// Stamp the metadata keys every protocol must carry for usage attribution.
///
/// Chat, messages and responses requests expose the same metadata map, so all three
/// surfaces record identical attribution keys.
fn stamp_core_metadata(
    metadata: &mut std::collections::HashMap<String, String>,
    auth: &AuthContext,
    virtual_model: &VirtualModel,
    strategy: &str,
    input_tokens: u32,
    output_tokens: u32,
) {
    metadata.insert("org_id".to_string(), auth.project.org_id.clone());
    metadata.insert("project_id".to_string(), auth.project.id.clone());
    metadata.insert("key_id".to_string(), auth.api_key.id.clone());
    metadata.insert("virtual_model_id".to_string(), virtual_model.id.clone());
    metadata.insert("pool_id".to_string(), virtual_model.pool_id.clone());
    metadata.insert("routing_strategy".to_string(), strategy.to_string());
    metadata.insert("input_tokens_est".to_string(), input_tokens.to_string());
    metadata.insert("output_tokens_est".to_string(), output_tokens.to_string());
}

/// Copy the budget headers onto a data-plane response.
fn apply_budget_headers(response: &mut Response, gate: &BudgetGate) {
    for (name, value) in budget_headers(&gate.outcome, gate.spent, gate.limit) {
        if let Some(name) = name {
            response.headers_mut().insert(name, value);
        }
    }
}

pub async fn chat_completions(
    State(state): State<Arc<AppState>>,
    auth: AuthContext,
    headers: HeaderMap,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    chat_proxy(state, auth, headers, payload, ChatProtocol::OpenAi).await
}

pub async fn anthropic_messages(
    State(state): State<Arc<AppState>>,
    auth: AuthContext,
    headers: HeaderMap,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    chat_proxy(state, auth, headers, payload, ChatProtocol::Anthropic).await
}

async fn chat_proxy(
    state: Arc<AppState>,
    auth: AuthContext,
    headers: HeaderMap,
    mut payload: serde_json::Value,
    protocol: ChatProtocol,
) -> Response {
    let requested_model = payload
        .get("model")
        .and_then(|m| m.as_str())
        .unwrap_or("")
        .to_string();

    let PoolContext {
        virtual_model,
        pool,
        strategy,
    } = or_return!(resolve_pool_context(&state, &auth, &requested_model).await);

    let warm_context = match parse_context_with_headers(&payload, Some(&headers)) {
        Ok(context) => context,
        Err(error) => return warm_error(warm_status(&error), error),
    };

    if let Some(context) = warm_context.as_ref() {
        state.warm_store.record_delta_attempt(context.delivery);
        if context.delivery == Delivery::Full {
            strip_context(&mut payload);
        }
    }

    // --- Control: progressive spend budget ---
    let gate = or_return!(enforce_spend_budget(&state, &auth, true).await);
    let spent = gate.spent;
    let limit = gate.limit;
    let downshift = gate.downshift;

    // --- Cost: context slim (disabled for Zene Warm snapshots) ---
    let tool_chars_before = tool_message_chars(&payload);
    let mut slimmed_chars = 0usize;
    let mut tools_touched = 0usize;
    let mut slim_dry_run = true;
    if warm_context.is_none() {
        if let Some(ref p) = pool {
            if p.tool_trim_enabled != 0 {
                let max_tool_chars = p.max_tool_chars.max(256) as usize;
                let cfg = SlimConfig {
                    max_tool_chars,
                    placeholder_after: max_tool_chars.saturating_mul(4),
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
    }

    // Hints for Cost/Capability scoring (after slim so token est matches forwarded body)
    let RequestSignals {
        prompt_text,
        input_tokens,
        output_tokens,
        difficulty: base_difficulty,
        has_tools,
        signals: mut signal_notes,
    } = request_signals(&payload);
    let mut difficulty = base_difficulty;
    let mut difficulty_source = "heuristic";
    let mut judge_used = false;

    let permit = or_return!(acquire_quota(&state, &auth).await);

    // If auxiliary judge model is enabled on this pool and complexity is in the ambiguous zone.
    if let Some(ref p) = pool {
        if p.judge_enabled != 0 {
            if let Some(ref judge_ep_id) = p.judge_endpoint_id {
                if (JUDGE_TRIGGER_MIN..=JUDGE_TRIGGER_MAX).contains(&difficulty) {
                    let scope = JudgeScope {
                        org_id: &auth.project.org_id,
                        project_id: &auth.project.id,
                        key_id: &auth.api_key.id,
                        virtual_model_id: &virtual_model.id,
                        source_pool_id: &virtual_model.pool_id,
                    };
                    if let Some(judge_tier) =
                        classify_with_judge(&state, judge_ep_id, &prompt_text, &scope).await
                    {
                        difficulty = judge_tier.score();
                        difficulty_source = "judge";
                        judge_used = true;
                        signal_notes.push(format!(
                            "Auxiliary Judge: {}",
                            judge_tier.as_str().to_uppercase()
                        ));
                    }
                }
            }
        }
    }

    let session_id = warm_context
        .as_ref()
        .and_then(|c| c.session_id.clone())
        .or_else(|| extract_session_id(&headers, &payload));
    let context_epoch = warm_context
        .as_ref()
        .and_then(|c| c.epoch)
        .map(|e| e.max(0) as u32)
        .unwrap_or_else(|| extract_context_epoch(&headers, &payload));
    let pfx_hash = warm_context
        .as_ref()
        .and_then(|c| c.prefix_hash.as_ref())
        .and_then(|h| u64::from_str_radix(h.trim_start_matches("0x"), 16).ok())
        .or_else(|| resolve_prefix_hash(&headers, &payload));
    let affinity_ttl = pool
        .as_ref()
        .map(|p| p.session_affinity_ttl_secs)
        .unwrap_or(3600);
    let member_count = state
        .pool_members
        .get(&virtual_model.pool_id)
        .map(|m| m.len())
        .unwrap_or(0);
    let affinity_enabled = pool
        .as_ref()
        .map(|p| p.session_affinity_enabled != 0)
        .unwrap_or(false)
        && session_id.is_some()
        && member_count > 1;
    let sticky_endpoint_id = session_id.as_ref().and_then(|sid| {
        get_sticky_endpoint(&virtual_model.pool_id, sid, context_epoch, affinity_ttl)
    });
    let affinity_applied = affinity_enabled && sticky_endpoint_id.is_some();
    let turn_index = session_id.as_ref().map(|sid| {
        next_turn_index(
            &virtual_model.pool_id,
            sid,
            context_epoch,
            pfx_hash,
            affinity_ttl,
        )
    });
    let is_prefix_stable = session_id
        .as_ref()
        .and_then(|sid| prefix_stable(&virtual_model.pool_id, sid, context_epoch, pfx_hash));

    let route_hint = RouteHint {
        input_tokens,
        output_tokens,
        has_tools,
        difficulty,
        downshift,
        pool_id: virtual_model.pool_id.clone(),
        affinity_enabled,
        sticky_endpoint_id: sticky_endpoint_id.clone(),
    };
    set_hint(route_hint.clone());
    let _hint_guard = HintGuard;
    state
        .hints
        .insert(virtual_model.pool_id.clone(), route_hint.clone());
    state
        .hints
        .insert(virtual_model.id.clone(), route_hint.clone());
    state
        .hints
        .insert(virtual_model.name.clone(), route_hint.clone());
    state
        .hints
        .insert(requested_model.clone(), route_hint.clone());

    // Same scoring the data plane will apply, recorded so the decision is visible
    // in usage logs instead of only in server logs.
    let candidates = state
        .feedback
        .explain(&virtual_model.pool_id, route_hint.clone());

    let prompt_preview = extract_user_prompt_preview(&payload);
    let difficulty_tier = difficulty_tier(difficulty);

    let decision = serde_json::json!({
        "product": "smartgate",
        "protocol": if protocol == ChatProtocol::Anthropic { "anthropic_messages" } else { "openai_chat" },
        "strategy": strategy,
        "input_tokens_est": input_tokens,
        "output_tokens_est": output_tokens,
        "difficulty": difficulty,
        "difficulty_tier": difficulty_tier.as_str(),
        "difficulty_source": difficulty_source,
        "judge_used": judge_used,
        "prompt_preview": prompt_preview,
        "signals": signal_notes,
        "has_tools": has_tools,
        "downshift": downshift,
        "spent_today": spent,
        "daily_limit": limit,
        "candidates": candidates,
        "context_slim": {
            "tool_chars_before": tool_chars_before,
            "slimmed_chars": slimmed_chars,
            "tools_touched": tools_touched,
            "dry_run": slim_dry_run,
            "session_id_required": warm_context.is_some(),
        },
        "warming": {
            "session_id": session_id,
            "context_epoch": context_epoch,
            "turn_index": turn_index,
            "prefix_hash": pfx_hash.map(format_prefix_hash),
            "affinity_enabled": affinity_enabled,
            "affinity_applied": affinity_applied,
            "affinity_hit": false,
            "sticky_endpoint_id": sticky_endpoint_id,
            "member_count": member_count,
            "prefix_stable": is_prefix_stable,
        },
    });

    let parsed_request = match protocol {
        ChatProtocol::OpenAi => {
            unigateway_sdk::protocol::openai_payload_to_chat_request(&payload, &requested_model)
        }
        ChatProtocol::Anthropic => {
            unigateway_sdk::protocol::anthropic_payload_to_chat_request(&payload, &requested_model)
        }
    };
    let mut proxy_request = match parsed_request {
        Ok(req) => req,
        Err(e) => {
            return (StatusCode::BAD_REQUEST, format!("Invalid request: {}", e)).into_response()
        }
    };

    stamp_core_metadata(
        &mut proxy_request.metadata,
        &auth,
        &virtual_model,
        &strategy,
        input_tokens,
        output_tokens,
    );
    if let Some(context) = warm_context.as_ref() {
        proxy_request.metadata.insert(
            "zene_session_id".to_string(),
            context.session_id.clone().unwrap_or_default(),
        );
        proxy_request.metadata.insert(
            "zene_delivery".to_string(),
            match context.delivery {
                Delivery::Full => "full".to_string(),
                Delivery::Delta => "delta".to_string(),
            },
        );
        if let Some(epoch) = context.epoch {
            proxy_request
                .metadata
                .insert("zene_context_epoch".to_string(), epoch.to_string());
        }
        if let Some(prefix_hash) = context.prefix_hash.clone() {
            proxy_request
                .metadata
                .insert("zene_prefix_hash".to_string(), prefix_hash);
        }
        if let Some(request_id) = context.request_id.clone() {
            proxy_request
                .metadata
                .insert("zene_request_id".to_string(), request_id);
        }
    }
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
    if let Some(ref sid) = session_id {
        proxy_request
            .metadata
            .insert("session_id".to_string(), sid.clone());
    }
    if let Some(turn) = turn_index {
        proxy_request
            .metadata
            .insert("turn_index".to_string(), turn.to_string());
    }
    if let Some(hash) = pfx_hash {
        proxy_request
            .metadata
            .insert("prefix_hash".to_string(), format_prefix_hash(hash));
    }
    proxy_request
        .metadata
        .insert("context_epoch".to_string(), context_epoch.to_string());
    proxy_request.metadata.insert(
        "affinity_enabled".to_string(),
        if affinity_enabled { "1" } else { "0" }.to_string(),
    );
    proxy_request.metadata.insert(
        "affinity_applied".to_string(),
        if affinity_applied { "1" } else { "0" }.to_string(),
    );
    if let Some(ref sticky) = sticky_endpoint_id {
        proxy_request
            .metadata
            .insert("sticky_endpoint_id".to_string(), sticky.clone());
    }
    proxy_request
        .metadata
        .insert("affinity_ttl_secs".to_string(), affinity_ttl.to_string());
    if downshift {
        proxy_request
            .metadata
            .insert("budget_downshift".to_string(), "1".to_string());
    }

    let warm_key = warm_context.as_ref().and_then(|context| {
        context.session_id.clone().map(|session_id| SessionKey {
            project_id: auth.project.id.clone(),
            api_key_id: auth.api_key.id.clone(),
            session_id,
        })
    });
    if let Err(error) = install_session_gateway_context(&mut proxy_request, warm_context.as_ref()) {
        return warm_error(warm_status(&error), error);
    }
    if let Some(key) = warm_key.as_ref() {
        if let Err(error) = state
            .warm_store
            .validate_virtual_model(key, Some(&virtual_model.id))
            .await
        {
            return warm_error(warm_status(&error), error);
        }
    }
    let middleware = warm_key
        .as_ref()
        .map(|key| state.warm_store.host_middleware(key));
    let pool_host = SmartGatePoolHost {
        engine: state.engine.as_ref(),
    };
    let host_context =
        unigateway_sdk::host::HostContext::from_parts(state.engine.as_ref(), &pool_host);
    let request = unigateway_sdk::host::HostRequest::Chat(proxy_request);
    let host_protocol = match protocol {
        ChatProtocol::OpenAi => unigateway_sdk::host::HostProtocol::OpenAiChat,
        ChatProtocol::Anthropic => unigateway_sdk::host::HostProtocol::AnthropicMessages,
    };
    let dispatch = crate::policy::TASK_ROUTE_HINT
        .scope(
            route_hint,
            unigateway_sdk::host::dispatch_request_with_middleware(
                &host_context,
                unigateway_sdk::host::HostDispatchTarget::Service(&virtual_model.pool_id),
                host_protocol,
                None,
                request,
                middleware.as_ref(),
            ),
        )
        .await;
    match dispatch {
        Ok(unigateway_sdk::host::HostDispatchOutcome::Response(response)) => {
            permit.disarm();
            if let Some(context) = warm_context.as_ref() {
                if context.delivery == Delivery::Delta {
                    state.warm_store.record_delta_result(true);
                }
            }

            // Shadow Flighting: mirror a sample of non-streaming requests to the configured
            // flagship model in the background and compare response previews.
            let (status, body) = response.into_parts();
            let is_json = matches!(
                &body,
                unigateway_sdk::protocol::ProtocolResponseBody::Json(_)
            );
            let shadow_config = pool.as_ref().and_then(|p| {
                if p.shadow_enabled == 0 {
                    return None;
                }
                let threshold = (p.shadow_sample_rate.clamp(0.0, 1.0) * 1_000_000.0) as u128;
                p.shadow_virtual_model_id
                    .clone()
                    .map(|name| (name, threshold))
            });
            let should_shadow = is_json
                && shadow_config.as_ref().is_some_and(|(_, threshold)| {
                    uuid::Uuid::new_v4().as_u128() % 1_000_000 < *threshold
                });

            let main_preview = if is_json {
                match &body {
                    unigateway_sdk::protocol::ProtocolResponseBody::Json(json) => {
                        extract_json_preview(json)
                    }
                    _ => String::new(),
                }
            } else {
                String::new()
            };

            if should_shadow {
                if let Some((shadow_model_name, _)) = shadow_config {
                    spawn_shadow(
                        ShadowRequest {
                            state: &state,
                            auth: &auth,
                            headers: &headers,
                            payload: &payload,
                            request_preview: &prompt_preview,
                            main_preview: &main_preview,
                            is_openai: protocol == ChatProtocol::OpenAi,
                        },
                        shadow_model_name,
                    );
                }
            }

            let response = match body {
                unigateway_sdk::protocol::ProtocolResponseBody::Json(json) => {
                    unigateway_sdk::protocol::ProtocolHttpResponse::json(status, json)
                }
                unigateway_sdk::protocol::ProtocolResponseBody::ServerSentEvents(stream) => {
                    unigateway_sdk::protocol::ProtocolHttpResponse::ok_sse(stream)
                }
            };
            let mut resp = protocol_response_to_axum(response);
            apply_budget_headers(&mut resp, &gate);
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
        Ok(unigateway_sdk::host::HostDispatchOutcome::PoolNotFound) => {
            (StatusCode::NOT_FOUND, "Model pool not found").into_response()
        }
        Ok(_) => (StatusCode::BAD_GATEWAY, "Unsupported host dispatch outcome").into_response(),
        Err(e) => {
            if warm_context
                .as_ref()
                .is_some_and(|context| context.delivery == Delivery::Delta)
            {
                state.warm_store.record_delta_result(false);
            }
            tracing::error!("Proxy error: {}", e);
            host_error_response(e)
        }
    }
}

pub async fn responses(
    State(state): State<Arc<AppState>>,
    auth: AuthContext,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    let requested_model = payload
        .get("model")
        .and_then(|model| model.as_str())
        .unwrap_or("")
        .to_string();

    let PoolContext {
        virtual_model,
        pool: _pool,
        strategy,
    } = or_return!(resolve_pool_context(&state, &auth, &requested_model).await);

    let gate = or_return!(enforce_spend_budget(&state, &auth, false).await);
    let spent = gate.spent;
    let limit = gate.limit;
    let downshift = gate.downshift;

    let RequestSignals {
        prompt_text,
        input_tokens,
        output_tokens,
        difficulty,
        has_tools,
        signals,
    } = request_signals(&payload);
    let difficulty_source = "heuristic";
    let judge_used = false;
    set_hint(RouteHint {
        input_tokens,
        output_tokens,
        has_tools,
        difficulty,
        downshift,
        pool_id: virtual_model.pool_id.clone(),
        affinity_enabled: false,
        sticky_endpoint_id: None,
    });
    let _hint_guard = HintGuard;

    let permit = or_return!(acquire_quota(&state, &auth).await);

    let mut proxy_request = match unigateway_sdk::protocol::openai_payload_to_responses_request(
        &payload,
        &requested_model,
    ) {
        Ok(request) => request,
        Err(error) => {
            return (
                StatusCode::BAD_REQUEST,
                format!("Invalid request: {}", error),
            )
                .into_response();
        }
    };
    stamp_core_metadata(
        &mut proxy_request.metadata,
        &auth,
        &virtual_model,
        &strategy,
        input_tokens,
        output_tokens,
    );
    let prompt_preview = prompt_text.chars().take(200).collect::<String>();
    let difficulty_tier = difficulty_tier(difficulty);
    proxy_request.metadata.insert(
        "routing_decision".to_string(),
        serde_json::json!({
            "product": "smartgate",
            "protocol": "responses",
            "input_tokens_est": input_tokens,
            "output_tokens_est": output_tokens,
            "difficulty": difficulty,
            "difficulty_tier": difficulty_tier.as_str(),
            "difficulty_source": difficulty_source,
            "judge_used": judge_used,
            "prompt_preview": prompt_preview,
            "signals": signals,
            "has_tools": has_tools,
            "downshift": downshift,
            "spent_today": spent,
            "daily_limit": limit,
        })
        .to_string(),
    );

    let target = ExecutionTarget::Pool {
        pool_id: virtual_model.pool_id,
    };
    match state.engine.proxy_responses(proxy_request, target).await {
        Ok(session) => {
            permit.disarm();
            let response = unigateway_sdk::protocol::render_openai_responses_session(session);
            let mut response = protocol_response_to_axum(response);
            apply_budget_headers(&mut response, &gate);
            response
        }
        Err(error) => {
            tracing::error!("Responses proxy error: {}", error);
            (
                StatusCode::BAD_GATEWAY,
                format!("Upstream error: {}", error),
            )
                .into_response()
        }
    }
}

fn host_error_response(error: HostError) -> Response {
    match error {
        HostError::CoreInvalidRequest(message) => {
            if let Some(warm) = warm_error_from_message(&message) {
                return warm_error(warm_status(&warm), warm);
            }
            (
                StatusCode::BAD_REQUEST,
                format!("Invalid request: {message}"),
            )
                .into_response()
        }
        HostError::CorePoolNotFound(_) | HostError::CoreEndpointNotFound(_) => {
            (StatusCode::NOT_FOUND, error.to_string()).into_response()
        }
        _ => (StatusCode::BAD_GATEWAY, format!("Upstream error: {error}")).into_response(),
    }
}

fn warm_error_from_message(message: &str) -> Option<WarmError> {
    let lower = message.to_ascii_lowercase();
    if lower.contains("session not found") {
        Some(WarmError::SessionNotFound)
    } else if lower.contains("session expired") {
        Some(WarmError::SessionExpired)
    } else if lower.contains("epoch mismatch") {
        Some(WarmError::EpochMismatch)
    } else if lower.contains("fingerprint mismatch") {
        Some(WarmError::PrefixHashMismatch)
    } else if lower.contains("tail_start mismatch") {
        let expected = parse_error_number(&lower, "expected ").unwrap_or_default();
        let actual = parse_error_number(&lower, "got ").unwrap_or_default();
        Some(WarmError::TailStartMismatch { expected, actual })
    } else if lower.contains("tail too large") {
        Some(WarmError::TailTooLarge)
    } else if lower.contains("assembled request too large") || lower.contains("assembled too large")
    {
        Some(WarmError::AssembledTooLarge)
    } else {
        None
    }
}

fn parse_error_number(message: &str, marker: &str) -> Option<usize> {
    let start = message.find(marker)? + marker.len();
    let digits = message[start..]
        .chars()
        .take_while(char::is_ascii_digit)
        .collect::<String>();
    digits.parse().ok()
}

fn warm_status(error: &WarmError) -> StatusCode {
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
                .expect("valid static response headers")
        }
    }
}
