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
    SessionKey, WarmContext, WarmError,
};
use axum::{
    extract::{Json, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use std::sync::Arc;
use unigateway_sdk::core::{ExecutionTarget, ProxyChatRequest};
use unigateway_sdk::host::{HostDispatchOutcome, HostError};
use unigateway_sdk::protocol::{ProtocolHttpResponse, ProtocolResponseBody};

use super::host::SmartGatePoolHost;
use super::judge::{classify_with_judge, difficulty_tier, DifficultyTier, JudgeScope};

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

/// Outcome of the chat-only context-slim stage.
struct SlimStats {
    tool_chars_before: usize,
    slimmed_chars: usize,
    tools_touched: usize,
    dry_run: bool,
}

/// Trim oversized tool messages in place when the resolved pool enables it.
///
/// Returns the counters recorded in usage metadata. The stage is skipped entirely for
/// Zene Warm snapshots (their context is already assembled) and while the pool is
/// unknown, and `dry_run` defaults to `true` so a skipped or dry-run pool reports the
/// same values as before.
fn slim_request_context(
    payload: &mut serde_json::Value,
    warm_active: bool,
    pool: Option<&ModelPool>,
) -> SlimStats {
    let tool_chars_before = tool_message_chars(payload);
    let mut stats = SlimStats {
        tool_chars_before,
        slimmed_chars: 0,
        tools_touched: 0,
        dry_run: true,
    };
    if warm_active {
        return stats;
    }
    let Some(pool) = pool else {
        return stats;
    };
    if pool.tool_trim_enabled == 0 {
        return stats;
    }
    let max_tool_chars = pool.max_tool_chars.max(256) as usize;
    let cfg = SlimConfig {
        max_tool_chars,
        placeholder_after: max_tool_chars.saturating_mul(4),
    };
    let result = slim_tool_messages(payload.clone(), &cfg);
    stats.slimmed_chars = result.slimmed_chars;
    stats.tools_touched = result.tools_touched;
    stats.dry_run = pool.tool_trim_dry_run != 0;
    if !stats.dry_run && result.modified {
        *payload = result.body;
    } else if result.modified {
        tracing::info!(
            target: "smartgate.slim",
            tool_chars_before = stats.tool_chars_before,
            slimmed_chars = stats.slimmed_chars,
            tools_touched = stats.tools_touched,
            dry_run = true,
            "context slim dry-run"
        );
    }
    stats
}

/// Ask the pool's auxiliary judge about a borderline prompt.
///
/// Only consulted when the pool enables the judge and the heuristic difficulty sits in
/// the ambiguous band; `None` means the heuristic score stands. Runs after the quota
/// reservation so judge usage is admitted like any other request.
async fn classify_borderline_difficulty(
    state: &AppState,
    auth: &AuthContext,
    pool: Option<&ModelPool>,
    virtual_model: &VirtualModel,
    prompt_text: &str,
    difficulty: f64,
) -> Option<DifficultyTier> {
    let pool = pool?;
    if pool.judge_enabled == 0 {
        return None;
    }
    let judge_endpoint_id = pool.judge_endpoint_id.as_ref()?;
    if !(JUDGE_TRIGGER_MIN..=JUDGE_TRIGGER_MAX).contains(&difficulty) {
        return None;
    }
    let scope = JudgeScope {
        org_id: &auth.project.org_id,
        project_id: &auth.project.id,
        key_id: &auth.api_key.id,
        virtual_model_id: &virtual_model.id,
        source_pool_id: &virtual_model.pool_id,
    };
    classify_with_judge(state, judge_endpoint_id, prompt_text, &scope).await
}

/// Session, warming and affinity facts derived once per chat request.
struct WarmAffinity {
    session_id: Option<String>,
    context_epoch: u32,
    prefix_hash: Option<u64>,
    affinity_ttl_secs: i32,
    member_count: usize,
    affinity_enabled: bool,
    sticky_endpoint_id: Option<String>,
    affinity_applied: bool,
    turn_index: Option<u32>,
    is_prefix_stable: Option<bool>,
}

/// Derive the warming/session/affinity facts shared by the hint, the decision and the
/// forwarded metadata.
///
/// Warm context wins over payload/header-derived values, and pool defaults apply while
/// the pool is unknown. Every read of session state happens here, once, so the recorded
/// decision and the forwarded metadata can never disagree.
fn derive_warm_affinity(
    state: &AppState,
    headers: &HeaderMap,
    payload: &serde_json::Value,
    virtual_model: &VirtualModel,
    pool: Option<&ModelPool>,
    warm_context: Option<&WarmContext>,
) -> WarmAffinity {
    let session_id = warm_context
        .and_then(|c| c.session_id.clone())
        .or_else(|| extract_session_id(headers, payload));
    let context_epoch = warm_context
        .and_then(|c| c.epoch)
        .map(|e| e.max(0) as u32)
        .unwrap_or_else(|| extract_context_epoch(headers, payload));
    let prefix_hash = warm_context
        .and_then(|c| c.prefix_hash.as_ref())
        .and_then(|h| u64::from_str_radix(h.trim_start_matches("0x"), 16).ok())
        .or_else(|| resolve_prefix_hash(headers, payload));
    let affinity_ttl_secs = pool.map(|p| p.session_affinity_ttl_secs).unwrap_or(3600);
    let member_count = state
        .pool_members
        .get(&virtual_model.pool_id)
        .map(|m| m.len())
        .unwrap_or(0);
    let affinity_enabled = pool
        .map(|p| p.session_affinity_enabled != 0)
        .unwrap_or(false)
        && session_id.is_some()
        && member_count > 1;
    let sticky_endpoint_id = session_id.as_ref().and_then(|sid| {
        get_sticky_endpoint(
            &virtual_model.pool_id,
            sid,
            context_epoch,
            affinity_ttl_secs,
        )
    });
    let affinity_applied = affinity_enabled && sticky_endpoint_id.is_some();
    let turn_index = session_id.as_ref().map(|sid| {
        next_turn_index(
            &virtual_model.pool_id,
            sid,
            context_epoch,
            prefix_hash,
            affinity_ttl_secs,
        )
    });
    let is_prefix_stable = session_id
        .as_ref()
        .and_then(|sid| prefix_stable(&virtual_model.pool_id, sid, context_epoch, prefix_hash));

    WarmAffinity {
        session_id,
        context_epoch,
        prefix_hash,
        affinity_ttl_secs,
        member_count,
        affinity_enabled,
        sticky_endpoint_id,
        affinity_applied,
        turn_index,
        is_prefix_stable,
    }
}

/// Publish the request's routing hint and return the candidate explanations.
///
/// The hint is stored under the pool id the data plane looks up and mirrored under the
/// virtual-model id/name and the requested model, so every alias resolves to the same
/// scoring input. The caller keeps the `HintGuard` alive for the request scope.
fn install_route_hint(
    state: &AppState,
    virtual_model: &VirtualModel,
    requested_model: &str,
    route_hint: &RouteHint,
) -> Vec<serde_json::Value> {
    set_hint(route_hint.clone());
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
        .insert(requested_model.to_string(), route_hint.clone());
    state
        .feedback
        .explain(&virtual_model.pool_id, route_hint.clone())
}

/// Inputs of the routing-decision document recorded in usage metadata.
struct DecisionInput<'a> {
    protocol: ChatProtocol,
    strategy: &'a str,
    signals: &'a RequestSignals,
    difficulty: f64,
    difficulty_source: &'a str,
    judge_used: bool,
    prompt_preview: &'a str,
    budget: &'a BudgetGate,
    candidates: &'a [serde_json::Value],
    slim: &'a SlimStats,
    affinity: &'a WarmAffinity,
    warm_active: bool,
}

/// Render the routing decision recorded in usage logs.
///
/// Mirrors the scoring the data plane applies so any routed request can be explained
/// from its usage row alone. Field names and nesting are part of that contract.
fn routing_decision(input: DecisionInput<'_>) -> serde_json::Value {
    serde_json::json!({
        "product": "smartgate",
        "protocol": if input.protocol == ChatProtocol::Anthropic { "anthropic_messages" } else { "openai_chat" },
        "strategy": input.strategy,
        "input_tokens_est": input.signals.input_tokens,
        "output_tokens_est": input.signals.output_tokens,
        "difficulty": input.difficulty,
        "difficulty_tier": difficulty_tier(input.difficulty).as_str(),
        "difficulty_source": input.difficulty_source,
        "judge_used": input.judge_used,
        "prompt_preview": input.prompt_preview,
        "signals": input.signals.signals,
        "has_tools": input.signals.has_tools,
        "downshift": input.budget.downshift,
        "spent_today": input.budget.spent,
        "daily_limit": input.budget.limit,
        "candidates": input.candidates,
        "context_slim": {
            "tool_chars_before": input.slim.tool_chars_before,
            "slimmed_chars": input.slim.slimmed_chars,
            "tools_touched": input.slim.tools_touched,
            "dry_run": input.slim.dry_run,
            "session_id_required": input.warm_active,
        },
        "warming": {
            "session_id": input.affinity.session_id,
            "context_epoch": input.affinity.context_epoch,
            "turn_index": input.affinity.turn_index,
            "prefix_hash": input.affinity.prefix_hash.map(format_prefix_hash),
            "affinity_enabled": input.affinity.affinity_enabled,
            "affinity_applied": input.affinity.affinity_applied,
            "affinity_hit": false,
            "sticky_endpoint_id": input.affinity.sticky_endpoint_id,
            "member_count": input.affinity.member_count,
            "prefix_stable": input.affinity.is_prefix_stable,
        },
    })
}

/// Stamp the chat-specific metadata keys on top of `stamp_core_metadata`.
///
/// Adds the Zene Warm provenance fields, the recorded routing decision, the cost-slim
/// counters and the session/affinity facts the data plane echoes back. Key names and
/// presence rules are part of the recorded usage contract.
fn stamp_chat_metadata(
    metadata: &mut std::collections::HashMap<String, String>,
    warm_context: Option<&WarmContext>,
    affinity: &WarmAffinity,
    slim: &SlimStats,
    decision: &serde_json::Value,
    downshift: bool,
) {
    if let Some(context) = warm_context {
        metadata.insert(
            "zene_session_id".to_string(),
            context.session_id.clone().unwrap_or_default(),
        );
        metadata.insert(
            "zene_delivery".to_string(),
            match context.delivery {
                Delivery::Full => "full".to_string(),
                Delivery::Delta => "delta".to_string(),
            },
        );
        if let Some(epoch) = context.epoch {
            metadata.insert("zene_context_epoch".to_string(), epoch.to_string());
        }
        if let Some(prefix_hash) = context.prefix_hash.clone() {
            metadata.insert("zene_prefix_hash".to_string(), prefix_hash);
        }
        if let Some(request_id) = context.request_id.clone() {
            metadata.insert("zene_request_id".to_string(), request_id);
        }
    }
    metadata.insert("routing_decision".to_string(), decision.to_string());
    metadata.insert(
        "tool_message_chars".to_string(),
        slim.tool_chars_before.to_string(),
    );
    metadata.insert("trimmed_chars".to_string(), slim.slimmed_chars.to_string());
    if let Some(sid) = affinity.session_id.as_ref() {
        metadata.insert("session_id".to_string(), sid.clone());
    }
    if let Some(turn) = affinity.turn_index {
        metadata.insert("turn_index".to_string(), turn.to_string());
    }
    if let Some(hash) = affinity.prefix_hash {
        metadata.insert("prefix_hash".to_string(), format_prefix_hash(hash));
    }
    metadata.insert(
        "context_epoch".to_string(),
        affinity.context_epoch.to_string(),
    );
    metadata.insert(
        "affinity_enabled".to_string(),
        if affinity.affinity_enabled { "1" } else { "0" }.to_string(),
    );
    metadata.insert(
        "affinity_applied".to_string(),
        if affinity.affinity_applied { "1" } else { "0" }.to_string(),
    );
    if let Some(sticky) = affinity.sticky_endpoint_id.as_ref() {
        metadata.insert("sticky_endpoint_id".to_string(), sticky.clone());
    }
    metadata.insert(
        "affinity_ttl_secs".to_string(),
        affinity.affinity_ttl_secs.to_string(),
    );
    if downshift {
        metadata.insert("budget_downshift".to_string(), "1".to_string());
    }
}

/// Parse the forwarded payload into the protocol-neutral chat request.
///
/// The OpenAI/Anthropic selection lives in one place, and a parse failure returns the
/// handler's historic `Invalid request: ...` message for it to wrap in a 400.
fn parse_chat_request(
    payload: &serde_json::Value,
    requested_model: &str,
    protocol: ChatProtocol,
) -> Result<ProxyChatRequest, String> {
    let parsed = match protocol {
        ChatProtocol::OpenAi => {
            unigateway_sdk::protocol::openai_payload_to_chat_request(payload, requested_model)
        }
        ChatProtocol::Anthropic => {
            unigateway_sdk::protocol::anthropic_payload_to_chat_request(payload, requested_model)
        }
    };
    parsed.map_err(|error| format!("Invalid request: {}", error))
}

/// Engine dispatch outcome for the chat surface.
///
/// The outer `Result` carries warm-glue failures as prepared responses; the inner one
/// is the raw engine result the handler maps to a status and body.
type ChatDispatchResult = Result<Result<HostDispatchOutcome, HostError>, Response>;

/// Install the warm-session glue, then dispatch the parsed chat request.
///
/// Warm failures keep their dedicated status/body mapping and are returned as the
/// prepared response; any other dispatch outcome is handed back to the handler.
async fn dispatch_chat_request(
    state: &Arc<AppState>,
    auth: &AuthContext,
    warm_context: Option<&WarmContext>,
    virtual_model: &VirtualModel,
    protocol: ChatProtocol,
    route_hint: RouteHint,
    mut proxy_request: ProxyChatRequest,
) -> ChatDispatchResult {
    let warm_key = warm_context.and_then(|context| {
        context.session_id.clone().map(|session_id| SessionKey {
            project_id: auth.project.id.clone(),
            api_key_id: auth.api_key.id.clone(),
            session_id,
        })
    });
    if let Err(error) = install_session_gateway_context(&mut proxy_request, warm_context) {
        return Err(warm_error(warm_status(&error), error));
    }
    if let Some(key) = warm_key.as_ref() {
        if let Err(error) = state
            .warm_store
            .validate_virtual_model(key, Some(&virtual_model.id))
            .await
        {
            return Err(warm_error(warm_status(&error), error));
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
    Ok(crate::policy::TASK_ROUTE_HINT
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
        .await)
}

/// Inputs for the best-effort shadow mirroring of one successful response.
struct ShadowMirror<'a> {
    state: &'a Arc<AppState>,
    auth: &'a AuthContext,
    headers: &'a HeaderMap,
    payload: &'a serde_json::Value,
    request_preview: &'a str,
    is_openai: bool,
}

/// Shadow Flighting: mirror a sample of non-streaming responses to the pool's flagship
/// model in the background and compare response previews.
///
/// Sampling is unchanged: only JSON bodies are eligible and the pool's configured rate
/// is compared against a fresh random draw. A dropped shadow permit still increments
/// the drop counter, and the user-facing response is never affected.
fn maybe_spawn_shadow(
    pool: Option<&ModelPool>,
    body: &ProtocolResponseBody,
    mirror: ShadowMirror<'_>,
) {
    let is_json = matches!(body, ProtocolResponseBody::Json(_));
    let shadow_config = pool.and_then(|p| {
        if p.shadow_enabled == 0 {
            return None;
        }
        let threshold = (p.shadow_sample_rate.clamp(0.0, 1.0) * 1_000_000.0) as u128;
        p.shadow_virtual_model_id
            .clone()
            .map(|name| (name, threshold))
    });
    let should_shadow = is_json
        && shadow_config
            .as_ref()
            .is_some_and(|(_, threshold)| uuid::Uuid::new_v4().as_u128() % 1_000_000 < *threshold);

    let main_preview = if is_json {
        match body {
            ProtocolResponseBody::Json(json) => extract_json_preview(json),
            _ => String::new(),
        }
    } else {
        String::new()
    };

    if should_shadow {
        if let Some((shadow_model_name, _)) = shadow_config {
            spawn_shadow(
                ShadowRequest {
                    state: mirror.state,
                    auth: mirror.auth,
                    headers: mirror.headers,
                    payload: mirror.payload,
                    request_preview: mirror.request_preview,
                    main_preview: &main_preview,
                    is_openai: mirror.is_openai,
                },
                shadow_model_name,
            );
        }
    }
}

/// Convert a data-plane response and add the chat surface's budget/slim headers.
///
/// The soft-budget marker and the slimmed-character count are chat-only response
/// decorations; the budget status/usage headers are shared by every proxy surface.
fn decorate_proxy_response(
    response: ProtocolHttpResponse,
    gate: &BudgetGate,
    slimmed_chars: usize,
) -> Response {
    let mut resp = protocol_response_to_axum(response);
    apply_budget_headers(&mut resp, gate);
    if gate.downshift {
        if let Ok(value) = HeaderValue::from_str("soft") {
            resp.headers_mut().insert("x-smartgate-budget", value);
        }
    }
    if slimmed_chars > 0 {
        if let Ok(value) = HeaderValue::from_str(&slimmed_chars.to_string()) {
            resp.headers_mut().insert("x-smartgate-slim-chars", value);
        }
    }
    resp
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

    // --- Cost: context slim (disabled for Zene Warm snapshots) ---
    let slim = slim_request_context(&mut payload, warm_context.is_some(), pool.as_ref());

    // Hints for Cost/Capability scoring (after slim so token est matches forwarded body)
    let mut signals = request_signals(&payload);
    let mut difficulty = signals.difficulty;
    let mut difficulty_source = "heuristic";
    let mut judge_used = false;

    let permit = or_return!(acquire_quota(&state, &auth).await);

    // If auxiliary judge model is enabled on this pool and complexity is in the ambiguous zone.
    if let Some(tier) = classify_borderline_difficulty(
        &state,
        &auth,
        pool.as_ref(),
        &virtual_model,
        &signals.prompt_text,
        difficulty,
    )
    .await
    {
        difficulty = tier.score();
        difficulty_source = "judge";
        judge_used = true;
        signals
            .signals
            .push(format!("Auxiliary Judge: {}", tier.as_str().to_uppercase()));
    }

    let affinity = derive_warm_affinity(
        &state,
        &headers,
        &payload,
        &virtual_model,
        pool.as_ref(),
        warm_context.as_ref(),
    );

    let route_hint = RouteHint {
        input_tokens: signals.input_tokens,
        output_tokens: signals.output_tokens,
        has_tools: signals.has_tools,
        difficulty,
        downshift: gate.downshift,
        pool_id: virtual_model.pool_id.clone(),
        affinity_enabled: affinity.affinity_enabled,
        sticky_endpoint_id: affinity.sticky_endpoint_id.clone(),
    };
    // Same scoring the data plane will apply, recorded so the decision is visible
    // in usage logs instead of only in server logs.
    let candidates = install_route_hint(&state, &virtual_model, &requested_model, &route_hint);
    let _hint_guard = HintGuard;

    let prompt_preview = extract_user_prompt_preview(&payload);
    let decision = routing_decision(DecisionInput {
        protocol,
        strategy: &strategy,
        signals: &signals,
        difficulty,
        difficulty_source,
        judge_used,
        prompt_preview: &prompt_preview,
        budget: &gate,
        candidates: &candidates,
        slim: &slim,
        affinity: &affinity,
        warm_active: warm_context.is_some(),
    });

    let mut proxy_request = match parse_chat_request(&payload, &requested_model, protocol) {
        Ok(request) => request,
        Err(message) => return (StatusCode::BAD_REQUEST, message).into_response(),
    };

    stamp_core_metadata(
        &mut proxy_request.metadata,
        &auth,
        &virtual_model,
        &strategy,
        signals.input_tokens,
        signals.output_tokens,
    );
    stamp_chat_metadata(
        &mut proxy_request.metadata,
        warm_context.as_ref(),
        &affinity,
        &slim,
        &decision,
        gate.downshift,
    );

    let dispatch = or_return!(
        dispatch_chat_request(
            &state,
            &auth,
            warm_context.as_ref(),
            &virtual_model,
            protocol,
            route_hint,
            proxy_request,
        )
        .await
    );

    match dispatch {
        Ok(HostDispatchOutcome::Response(response)) => {
            permit.disarm();
            if let Some(context) = warm_context.as_ref() {
                if context.delivery == Delivery::Delta {
                    state.warm_store.record_delta_result(true);
                }
            }

            let (status, body) = response.into_parts();
            maybe_spawn_shadow(
                pool.as_ref(),
                &body,
                ShadowMirror {
                    state: &state,
                    auth: &auth,
                    headers: &headers,
                    payload: &payload,
                    request_preview: &prompt_preview,
                    is_openai: protocol == ChatProtocol::OpenAi,
                },
            );

            let response = match body {
                ProtocolResponseBody::Json(json) => ProtocolHttpResponse::json(status, json),
                ProtocolResponseBody::ServerSentEvents(stream) => {
                    ProtocolHttpResponse::ok_sse(stream)
                }
            };
            decorate_proxy_response(response, &gate, slim.slimmed_chars)
        }
        Ok(HostDispatchOutcome::PoolNotFound) => {
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

fn protocol_response_to_axum(resp: ProtocolHttpResponse) -> Response {
    use axum::body::Body;

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
