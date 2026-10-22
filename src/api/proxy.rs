//! SmartGate data-plane router & proxy:
//! Control (auth/budget/quota) → Cost slim → Heuristic complexity scoring (Auto/Pro/Flash)
//! → xlite high-performance forwarding (with direct multi-endpoint failover fallback).

use crate::auth::{resolve_authorized_virtual_model, AuthContext};
use crate::config::AppState;
use crate::models::{ModelPool, VirtualModel};
use crate::policy::{
    effective_daily_limit, estimate_tokens_from_text, evaluate_budget, expected_output_tokens,
    extract_complexity_signals, extract_context_epoch, extract_openai_prompt_text,
    extract_session_id, extract_user_prompt_preview, format_prefix_hash, get_sticky_endpoint,
    heuristic_difficulty, next_turn_index, prefix_stable, request_has_tools, resolve_prefix_hash,
    set_hint, slim_tool_messages, spent_today_for_key, tool_message_chars, BudgetOutcome,
    HintGuard, RouteHint, SlimConfig, DIFFICULTY_HIGH_THRESHOLD, DIFFICULTY_MEDIUM_THRESHOLD,
};
use crate::quota::{QuotaLimits, QuotaPermit};
use crate::routing::canonicalize_strategy;
use crate::sync::{normalize_base_url, SyncEndpointRow};
use crate::usage::{record_attempt_metric, record_request_usage, UsageRecordInput};
use axum::{
    body::Body,
    extract::{Json, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use futures_util::StreamExt;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

#[derive(Clone, Copy, PartialEq, Eq)]
enum ChatProtocol {
    OpenAiChat,
    AnthropicMessages,
    OpenAiResponses,
}

macro_rules! or_return {
    ($stage:expr) => {
        match $stage {
            Ok(value) => value,
            Err(response) => return response,
        }
    };
}

fn difficulty_tier_str(difficulty: f64) -> &'static str {
    if difficulty >= DIFFICULTY_HIGH_THRESHOLD {
        "complex"
    } else if difficulty >= DIFFICULTY_MEDIUM_THRESHOLD {
        "medium"
    } else {
        "simple"
    }
}

struct PoolContext {
    virtual_model: VirtualModel,
    pool: Option<ModelPool>,
    strategy: String,
}

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

struct BudgetGate {
    outcome: BudgetOutcome,
    spent: f64,
    limit: Option<f64>,
    downshift: bool,
}

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

struct RequestSignals {
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
    }
}

fn stamp_core_metadata(
    metadata: &mut HashMap<String, String>,
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

fn apply_budget_headers(response: &mut Response, gate: &BudgetGate, slimmed_chars: usize) {
    for (name, value) in budget_headers(&gate.outcome, gate.spent, gate.limit) {
        if let Some(name) = name {
            response.headers_mut().insert(name, value);
        }
    }
    if gate.downshift {
        if let Ok(value) = HeaderValue::from_str("soft") {
            response.headers_mut().insert("x-smartgate-budget", value);
        }
    }
    if slimmed_chars > 0 {
        if let Ok(value) = HeaderValue::from_str(&slimmed_chars.to_string()) {
            response
                .headers_mut()
                .insert("x-smartgate-slim-chars", value);
        }
    }
}

struct SlimStats {
    tool_chars_before: usize,
    slimmed_chars: usize,
    tools_touched: usize,
    dry_run: bool,
}

fn slim_request_context(payload: &mut serde_json::Value, pool: Option<&ModelPool>) -> SlimStats {
    let tool_chars_before = tool_message_chars(payload);
    let mut stats = SlimStats {
        tool_chars_before,
        slimmed_chars: 0,
        tools_touched: 0,
        dry_run: true,
    };
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
    }
    stats
}

struct SessionAffinityInfo {
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

fn derive_session_affinity(
    state: &AppState,
    headers: &HeaderMap,
    payload: &serde_json::Value,
    virtual_model: &VirtualModel,
    pool: Option<&ModelPool>,
) -> SessionAffinityInfo {
    let session_id = extract_session_id(headers, payload);
    let context_epoch = extract_context_epoch(headers, payload);
    let prefix_hash = resolve_prefix_hash(headers, payload);
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

    SessionAffinityInfo {
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

pub async fn chat_completions(
    State(state): State<Arc<AppState>>,
    auth: AuthContext,
    headers: HeaderMap,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    proxy_request_handler(state, auth, headers, payload, ChatProtocol::OpenAiChat).await
}

pub async fn anthropic_messages(
    State(state): State<Arc<AppState>>,
    auth: AuthContext,
    headers: HeaderMap,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    proxy_request_handler(
        state,
        auth,
        headers,
        payload,
        ChatProtocol::AnthropicMessages,
    )
    .await
}

pub async fn responses(
    State(state): State<Arc<AppState>>,
    auth: AuthContext,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    proxy_request_handler(
        state,
        auth,
        HeaderMap::new(),
        payload,
        ChatProtocol::OpenAiResponses,
    )
    .await
}

async fn proxy_request_handler(
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

    if requested_model.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, "Invalid request: missing model").into_response();
    }

    let PoolContext {
        virtual_model,
        pool,
        strategy,
    } = or_return!(resolve_pool_context(&state, &auth, &requested_model).await);

    let include_detail = protocol != ChatProtocol::OpenAiResponses;
    let gate = or_return!(enforce_spend_budget(&state, &auth, include_detail).await);

    let slim = if protocol == ChatProtocol::OpenAiResponses {
        SlimStats {
            tool_chars_before: 0,
            slimmed_chars: 0,
            tools_touched: 0,
            dry_run: true,
        }
    } else {
        slim_request_context(&mut payload, pool.as_ref())
    };

    let signals = request_signals(&payload);
    let difficulty = signals.difficulty;
    let _permit = or_return!(acquire_quota(&state, &auth).await);

    let affinity =
        derive_session_affinity(&state, &headers, &payload, &virtual_model, pool.as_ref());

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

    let candidates = install_route_hint(&state, &virtual_model, &requested_model, &route_hint);
    let ranked_endpoints = state
        .feedback
        .rank_endpoints(&virtual_model.pool_id, Some(route_hint.clone()));
    let _hint_guard = HintGuard;

    let prompt_preview = extract_user_prompt_preview(&payload);
    let protocol_label = match protocol {
        ChatProtocol::OpenAiChat => "openai_chat",
        ChatProtocol::AnthropicMessages => "anthropic_messages",
        ChatProtocol::OpenAiResponses => "responses",
    };

    let decision = serde_json::json!({
        "product": "smartgate",
        "protocol": protocol_label,
        "strategy": strategy,
        "input_tokens_est": signals.input_tokens,
        "output_tokens_est": signals.output_tokens,
        "difficulty": difficulty,
        "difficulty_tier": difficulty_tier_str(difficulty),
        "difficulty_source": "heuristic",
        "judge_used": false,
        "prompt_preview": prompt_preview,
        "signals": signals.signals,
        "has_tools": signals.has_tools,
        "downshift": gate.downshift,
        "spent_today": gate.spent,
        "daily_limit": gate.limit,
        "candidates": candidates,
        "context_slim": {
            "tool_chars_before": slim.tool_chars_before,
            "slimmed_chars": slim.slimmed_chars,
            "tools_touched": slim.tools_touched,
            "dry_run": slim.dry_run,
            "session_id_required": false,
        },
        "warming": {
            "session_id": affinity.session_id,
            "context_epoch": affinity.context_epoch,
            "turn_index": affinity.turn_index,
            "prefix_hash": affinity.prefix_hash.map(format_prefix_hash),
            "affinity_enabled": affinity.affinity_enabled,
            "affinity_applied": affinity.affinity_applied,
            "affinity_hit": false,
            "sticky_endpoint_id": affinity.sticky_endpoint_id,
            "member_count": affinity.member_count,
            "prefix_stable": affinity.is_prefix_stable,
        },
    });

    let mut metadata = HashMap::new();
    stamp_core_metadata(
        &mut metadata,
        &auth,
        &virtual_model,
        &strategy,
        signals.input_tokens,
        signals.output_tokens,
    );
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
    if gate.downshift {
        metadata.insert("budget_downshift".to_string(), "1".to_string());
    }

    if ranked_endpoints.is_empty() {
        return (StatusCode::NOT_FOUND, "Model pool has no active endpoints").into_response();
    }

    // 1. If standalone `xlite` data plane is configured (`XLITE_UPSTREAM_URL`), try forwarding via `xlite` first!
    if let Some(xlite_url) = state.config.xlite_url.as_deref() {
        let primary_ep_id = ranked_endpoints[0].clone();
        let xlite_target_model = format!("ep:{}", primary_ep_id);
        if let Some(mut resp) = try_forward_via_xlite(
            &state,
            xlite_url,
            &xlite_target_model,
            &primary_ep_id,
            &payload,
            protocol,
            &metadata,
        )
        .await
        {
            apply_budget_headers(&mut resp, &gate, slim.slimmed_chars);
            return resp;
        }
    }

    // 2. Direct multi-endpoint dispatch with automatic failover across ranked candidates
    let mut resp = dispatch_direct_with_failover(
        &state,
        &ranked_endpoints,
        &strategy,
        &payload,
        protocol,
        metadata,
    )
    .await;

    apply_budget_headers(&mut resp, &gate, slim.slimmed_chars);
    resp
}

async fn try_forward_via_xlite(
    state: &Arc<AppState>,
    xlite_url: &str,
    xlite_model: &str,
    primary_ep_id: &str,
    payload: &serde_json::Value,
    protocol: ChatProtocol,
    metadata: &HashMap<String, String>,
) -> Option<Response> {
    let path = match protocol {
        ChatProtocol::OpenAiChat => "/v1/chat/completions",
        ChatProtocol::AnthropicMessages => "/v1/messages",
        ChatProtocol::OpenAiResponses => "/v1/responses",
    };
    let url = format!("{}{}", xlite_url.trim_end_matches('/'), path);
    let mut body_val = payload.clone();
    if let Some(obj) = body_val.as_object_mut() {
        obj.insert(
            "model".to_string(),
            serde_json::Value::String(xlite_model.to_string()),
        );
    }

    let start = Instant::now();
    let resp = match state
        .http_client
        .post(&url)
        .header(
            "Authorization",
            format!("Bearer {}", state.config.xlite_internal_key),
        )
        .json(&body_val)
        .send()
        .await
    {
        Ok(r) => r,
        Err(err) => {
            tracing::warn!(
                target: "smartgate.xlite",
                error = %err,
                "xlite data-plane unreachable; falling back to direct upstream dispatch"
            );
            return None;
        }
    };

    let status = resp.status();
    let latency_ms = start.elapsed().as_millis() as u64;

    // xlite already fanned out across the candidate's backup channels; if even that failed with a
    // retryable status, let the direct dispatcher try the remaining ranked endpoints instead.
    if status == StatusCode::TOO_MANY_REQUESTS
        || status == StatusCode::NOT_FOUND
        || status.is_server_error()
    {
        tracing::warn!(
            target: "smartgate.xlite",
            endpoint_id = %primary_ep_id,
            status = status.as_u16(),
            "xlite returned a retryable status; failing over to direct upstream dispatch"
        );
        record_attempt_metric(state, primary_ep_id, false, latency_ms as f64).await;
        return None;
    }

    record_attempt_metric(state, primary_ep_id, status.is_success(), latency_ms as f64).await;

    let account_id = state
        .endpoints
        .get(primary_ep_id)
        .map(|ep| ep.account_id.clone());

    Some(
        convert_upstream_response(
            state.clone(),
            resp,
            primary_ep_id.to_string(),
            account_id,
            latency_ms,
            vec![format!("{}:{}", primary_ep_id, status.as_u16())],
            metadata.clone(),
        )
        .await,
    )
}

async fn dispatch_direct_with_failover(
    state: &Arc<AppState>,
    ranked_endpoints: &[String],
    strategy: &str,
    payload: &serde_json::Value,
    protocol: ChatProtocol,
    metadata: HashMap<String, String>,
) -> Response {
    let max_attempts = match strategy {
        "fallback" | "capability_aware" | "cost_aware" => ranked_endpoints.len().max(1),
        _ => ranked_endpoints.len().clamp(1, 2),
    };

    let mut attempts = Vec::new();
    let mut last_error: Option<(StatusCode, String)> = None;

    for (idx, ep_id) in ranked_endpoints.iter().take(max_attempts).enumerate() {
        let Some(ep) = resolve_endpoint(state, ep_id).await else {
            continue;
        };

        let mut upstream_body = payload.clone();
        if let Some(obj) = upstream_body.as_object_mut() {
            obj.insert(
                "model".to_string(),
                serde_json::Value::String(ep.upstream_model_id.clone()),
            );
        }

        let base = normalize_base_url(&ep.base_url);
        let url = match protocol {
            ChatProtocol::OpenAiChat => format!("{}chat/completions", base),
            ChatProtocol::AnthropicMessages => format!("{}messages", base),
            ChatProtocol::OpenAiResponses => format!("{}responses", base),
        };

        let start = Instant::now();
        let mut req = state.http_client.post(&url);
        if ep.protocol.eq_ignore_ascii_case("anthropic")
            || protocol == ChatProtocol::AnthropicMessages
        {
            req = req
                .header("x-api-key", &ep.api_key)
                .header("anthropic-version", "2023-06-01")
                .header("Authorization", format!("Bearer {}", ep.api_key));
        } else {
            req = req.header("Authorization", format!("Bearer {}", ep.api_key));
        }

        match req.json(&upstream_body).send().await {
            Ok(resp) => {
                let status = resp.status();
                let latency_ms = start.elapsed().as_millis() as u64;
                // 404 is retried as well: free upstream catalogs retire models often, so a dead
                // model id on one candidate must not fail the whole request.
                let should_retry = (status == StatusCode::TOO_MANY_REQUESTS
                    || status == StatusCode::NOT_FOUND
                    || status.is_server_error())
                    && (idx + 1 < max_attempts);

                attempts.push(format!("{}:{}", ep.id, status.as_u16()));
                record_attempt_metric(state, &ep.id, status.is_success(), latency_ms as f64).await;

                if should_retry {
                    let body_text = resp.text().await.unwrap_or_default();
                    tracing::warn!(
                        target: "smartgate.routing",
                        endpoint_id = %ep.id,
                        status = status.as_u16(),
                        "primary endpoint returned retryable status; failing over to next candidate"
                    );
                    last_error = Some((status, body_text));
                    continue;
                }

                return convert_upstream_response(
                    state.clone(),
                    resp,
                    ep.id.clone(),
                    Some(ep.account_id.clone()),
                    latency_ms,
                    attempts,
                    metadata,
                )
                .await;
            }
            Err(err) => {
                let latency_ms = start.elapsed().as_millis() as u64;
                attempts.push(format!("{}:transport_error", ep.id));
                record_attempt_metric(state, &ep.id, false, latency_ms as f64).await;
                last_error = Some((StatusCode::BAD_GATEWAY, format!("Upstream error: {}", err)));
                if idx + 1 < max_attempts {
                    continue;
                }
            }
        }
    }

    let (status, msg) = last_error.unwrap_or((
        StatusCode::BAD_GATEWAY,
        "No healthy upstream endpoint".to_string(),
    ));
    record_request_usage(
        state,
        UsageRecordInput {
            endpoint_id: ranked_endpoints
                .first()
                .cloned()
                .unwrap_or_else(|| "unknown".to_string()),
            provider_account_id: None,
            latency_ms: 0,
            status_code: status.as_u16(),
            error_message: Some(msg.clone()),
            provider_input_tokens: None,
            provider_output_tokens: None,
            provider_total_tokens: None,
            cache_hit_tokens: None,
            cache_write_tokens: None,
            ttft_ms: None,
            attempts,
            metadata,
        },
    )
    .await;

    (status, msg).into_response()
}

async fn resolve_endpoint(state: &AppState, endpoint_id: &str) -> Option<SyncEndpointRow> {
    if let Some(ep) = state.endpoints.get(endpoint_id) {
        return Some(ep.clone());
    }
    sqlx::query_as::<_, SyncEndpointRow>(
        "SELECT e.id, e.account_id, e.upstream_model_id, e.enabled,
                0 AS pool_priority, 0 AS pool_weight,
                pa.provider_type, pa.protocol, pa.base_url, pa.api_key, pa.name AS account_name,
                e.input_price_per_1m, e.output_price_per_1m,
                e.capability_score, e.supports_tools, e.context_length,
                e.health_status, e.cooldown_until
         FROM endpoints e
         JOIN provider_accounts pa ON pa.id = e.account_id
         WHERE e.id = $1 AND e.enabled = TRUE AND pa.status = 'active'",
    )
    .bind(endpoint_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
}

async fn convert_upstream_response(
    state: Arc<AppState>,
    resp: reqwest::Response,
    endpoint_id: String,
    provider_account_id: Option<String>,
    latency_ms: u64,
    attempts: Vec<String>,
    metadata: HashMap<String, String>,
) -> Response {
    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let is_sse = resp
        .headers()
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|ct| ct.contains("text/event-stream"))
        .unwrap_or(false);

    if is_sse {
        let byte_stream = resp.bytes_stream();
        let stream_start = Instant::now();
        let out_stream = sse_stream_with_usage(
            state,
            endpoint_id,
            provider_account_id,
            status.as_u16(),
            stream_start,
            attempts,
            metadata,
            byte_stream,
        );
        return Response::builder()
            .status(status)
            .header("content-type", "text/event-stream")
            .header("cache-control", "no-cache")
            .header("connection", "keep-alive")
            .body(Body::from_stream(out_stream))
            .expect("valid SSE response");
    }

    let bytes = match resp.bytes().await {
        Ok(b) => b,
        Err(err) => {
            let msg = format!("Failed to read upstream body: {}", err);
            record_request_usage(
                &state,
                UsageRecordInput {
                    endpoint_id,
                    provider_account_id,
                    latency_ms,
                    status_code: 502,
                    error_message: Some(msg.clone()),
                    provider_input_tokens: None,
                    provider_output_tokens: None,
                    provider_total_tokens: None,
                    cache_hit_tokens: None,
                    cache_write_tokens: None,
                    ttft_ms: None,
                    attempts,
                    metadata,
                },
            )
            .await;
            return (StatusCode::BAD_GATEWAY, msg).into_response();
        }
    };

    let parsed_json: Option<serde_json::Value> = serde_json::from_slice(&bytes).ok();
    let (in_tok, out_tok, tot_tok, cache_hit, cache_write) = parsed_json
        .as_ref()
        .map(extract_usage_tokens)
        .unwrap_or((None, None, None, None, None));

    let error_message = if !status.is_success() {
        Some(String::from_utf8_lossy(&bytes).chars().take(300).collect())
    } else {
        None
    };

    record_request_usage(
        &state,
        UsageRecordInput {
            endpoint_id,
            provider_account_id,
            latency_ms,
            status_code: status.as_u16(),
            error_message,
            provider_input_tokens: in_tok,
            provider_output_tokens: out_tok,
            provider_total_tokens: tot_tok,
            cache_hit_tokens: cache_hit,
            cache_write_tokens: cache_write,
            ttft_ms: None,
            attempts,
            metadata,
        },
    )
    .await;

    if let Some(json_val) = parsed_json {
        (status, Json(json_val)).into_response()
    } else {
        Response::builder()
            .status(status)
            .header("content-type", "application/json")
            .body(Body::from(bytes))
            .unwrap_or_else(|_| (status, "").into_response())
    }
}

#[allow(clippy::too_many_arguments)]
fn sse_stream_with_usage<S>(
    state: Arc<AppState>,
    endpoint_id: String,
    provider_account_id: Option<String>,
    status_code: u16,
    stream_start: Instant,
    attempts: Vec<String>,
    metadata: HashMap<String, String>,
    byte_stream: S,
) -> impl futures_util::Stream<Item = Result<axum::body::Bytes, std::io::Error>>
where
    S: futures_util::Stream<Item = Result<axum::body::Bytes, reqwest::Error>>
        + Unpin
        + Send
        + 'static,
{
    struct SseState<S> {
        inner: S,
        state: Arc<AppState>,
        endpoint_id: String,
        provider_account_id: Option<String>,
        status_code: u16,
        stream_start: Instant,
        ttft_ms: Option<i32>,
        in_tok: Option<u64>,
        out_tok: Option<u64>,
        tot_tok: Option<u64>,
        cache_hit: Option<u64>,
        cache_write: Option<u64>,
        attempts: Vec<String>,
        metadata: HashMap<String, String>,
        done: bool,
    }

    let init = SseState {
        inner: byte_stream,
        state,
        endpoint_id,
        provider_account_id,
        status_code,
        stream_start,
        ttft_ms: None,
        in_tok: None,
        out_tok: None,
        tot_tok: None,
        cache_hit: None,
        cache_write: None,
        attempts,
        metadata,
        done: false,
    };

    futures_util::stream::unfold(init, |mut st| async move {
        if st.done {
            return None;
        }
        match st.inner.next().await {
            Some(Ok(chunk)) => {
                if st.ttft_ms.is_none() {
                    st.ttft_ms = Some(st.stream_start.elapsed().as_millis() as i32);
                }
                if let Ok(text) = std::str::from_utf8(&chunk) {
                    for line in text.lines() {
                        if let Some(data) = line.strip_prefix("data:") {
                            let data = data.trim();
                            if data != "[DONE]" && data.contains("\"usage\"") {
                                if let Ok(val) = serde_json::from_str::<serde_json::Value>(data) {
                                    let (i, o, t, ch, cw) = extract_usage_tokens(&val);
                                    if i.is_some() {
                                        st.in_tok = i;
                                    }
                                    if o.is_some() {
                                        st.out_tok = o;
                                    }
                                    if t.is_some() {
                                        st.tot_tok = t;
                                    }
                                    if ch.is_some() {
                                        st.cache_hit = ch;
                                    }
                                    if cw.is_some() {
                                        st.cache_write = cw;
                                    }
                                }
                            }
                        }
                    }
                }
                Some((Ok(chunk), st))
            }
            Some(Err(err)) => {
                st.done = true;
                record_request_usage(
                    &st.state,
                    UsageRecordInput {
                        endpoint_id: st.endpoint_id.clone(),
                        provider_account_id: st.provider_account_id.clone(),
                        latency_ms: st.stream_start.elapsed().as_millis() as u64,
                        status_code: st.status_code,
                        error_message: Some(err.to_string()),
                        provider_input_tokens: st.in_tok,
                        provider_output_tokens: st.out_tok,
                        provider_total_tokens: st.tot_tok,
                        cache_hit_tokens: st.cache_hit,
                        cache_write_tokens: st.cache_write,
                        ttft_ms: st.ttft_ms,
                        attempts: st.attempts.clone(),
                        metadata: st.metadata.clone(),
                    },
                )
                .await;
                Some((Err(std::io::Error::other(err.to_string())), st))
            }
            None => {
                st.done = true;
                record_request_usage(
                    &st.state,
                    UsageRecordInput {
                        endpoint_id: st.endpoint_id.clone(),
                        provider_account_id: st.provider_account_id.clone(),
                        latency_ms: st.stream_start.elapsed().as_millis() as u64,
                        status_code: st.status_code,
                        error_message: None,
                        provider_input_tokens: st.in_tok,
                        provider_output_tokens: st.out_tok,
                        provider_total_tokens: st.tot_tok,
                        cache_hit_tokens: st.cache_hit,
                        cache_write_tokens: st.cache_write,
                        ttft_ms: st.ttft_ms,
                        attempts: st.attempts.clone(),
                        metadata: st.metadata.clone(),
                    },
                )
                .await;
                None
            }
        }
    })
}

/// `(input, output, total, cache_hit, cache_write)` token counts parsed from a provider payload.
type UsageTokens = (
    Option<u64>,
    Option<u64>,
    Option<u64>,
    Option<u64>,
    Option<u64>,
);

fn extract_usage_tokens(val: &serde_json::Value) -> UsageTokens {
    let Some(usage) = val.get("usage") else {
        return (None, None, None, None, None);
    };
    let input = usage
        .get("prompt_tokens")
        .or_else(|| usage.get("input_tokens"))
        .and_then(|v| v.as_u64());
    let output = usage
        .get("completion_tokens")
        .or_else(|| usage.get("output_tokens"))
        .and_then(|v| v.as_u64());
    let total = usage.get("total_tokens").and_then(|v| v.as_u64());
    let cache_hit = usage
        .get("prompt_tokens_details")
        .and_then(|d| d.get("cached_tokens"))
        .or_else(|| usage.get("cache_read_input_tokens"))
        .or_else(|| usage.get("prompt_cache_hit_tokens"))
        .and_then(|v| v.as_u64());
    let cache_write = usage
        .get("cache_creation_input_tokens")
        .and_then(|v| v.as_u64());
    (input, output, total, cache_hit, cache_write)
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
