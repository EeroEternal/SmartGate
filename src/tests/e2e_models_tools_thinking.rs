//! End-to-end regression coverage for:
//! 1. Multiple API keys with distinct model authorizations.
//! 2. Thinking / Reasoning models (DeepSeek R1 reasoning_content handling).
//! 3. Tools and Function Calling (OpenAI tools & tool_calls).
//! 4. Automatic failover routing (smartgate/auto fallback strategy).

use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::{Json, Router};
use dashmap::DashMap;
use serde_json::{json, Value};
use sqlx::PgPool;
use unigateway_sdk::core::UniGatewayEngine;

use crate::auth::{hash_token, AuthContext};
use crate::config::{AppState, Config, ShadowConfig};
use crate::models::{ApiKey, Project};
use crate::quota::QuotaLimiter;
use crate::routing::SmartGateFeedbackProvider;
use crate::usage::SmartGateHooks;
use crate::warm::{WarmConfig, WarmStore};

const TEST_DATABASE_URL_ENV: &str = "SMARTGATE_TEST_DATABASE_URL";

const ORG_ID: &str = "org-e2e-test";
const PROJECT_ID: &str = "project-e2e-test";
const ACCOUNT_ID: &str = "account-e2e-test";

const KEY1_ID: &str = "key-dev-all";
const KEY1_TOKEN: &str = "sg-e2e-key1";

const KEY2_ID: &str = "key-restricted";
const KEY2_TOKEN: &str = "sg-e2e-key2";

const KEY3_ID: &str = "key-auto";
const KEY3_TOKEN: &str = "sg-e2e-key3";

const MODEL_R1: &str = "smartgate/deepseek-r1:1";
const MODEL_CHAT: &str = "smartgate/deepseek-chat:1";
const MODEL_GLM: &str = "smartgate/glm-4:1";
const MODEL_AUTO: &str = "smartgate/auto";

#[derive(Debug, Clone)]
struct RecordedCall {
    path: String,
    body: Value,
}

#[derive(Clone)]
struct E2eMockState {
    calls: Arc<Mutex<Vec<RecordedCall>>>,
    fail_first_call: Arc<Mutex<bool>>,
}

/// Intelligent mock upstream that handles reasoning, tools, and error simulation.
async fn e2e_mock_handler(
    State(state): State<E2eMockState>,
    _headers: HeaderMap,
    body: Bytes,
) -> Response {
    let parsed: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    state.calls.lock().unwrap().push(RecordedCall {
        path: "/chat/completions".to_string(),
        body: parsed.clone(),
    });

    let model = parsed.get("model").and_then(Value::as_str).unwrap_or("");

    // 1. Simulate failure if requested (for auto-failover testing)
    if model == "failing-model" {
        let mut fail_flag = state.fail_first_call.lock().unwrap();
        if *fail_flag {
            *fail_flag = false;
            return (
                StatusCode::TOO_MANY_REQUESTS,
                Json(json!({
                    "error": {
                        "message": "Rate limit exceeded on primary model",
                        "type": "requests",
                        "code": 429
                    }
                })),
            )
                .into_response();
        }
    }

    // 2. Tools / Function calling response
    if let Some(tools) = parsed.get("tools").and_then(Value::as_array) {
        if !tools.is_empty() {
            return Json(json!({
                "id": "chatcmpl-tools-test",
                "object": "chat.completion",
                "created": 1790900000,
                "model": model,
                "choices": [{
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": null,
                        "tool_calls": [{
                            "id": "call_weather_123",
                            "type": "function",
                            "function": {
                                "name": "get_current_weather",
                                "arguments": "{\"location\":\"Tokyo\"}"
                            }
                        }]
                    },
                    "finish_reason": "tool_calls"
                }],
                "usage": {"prompt_tokens": 40, "completion_tokens": 15, "total_tokens": 55}
            }))
            .into_response();
        }
    }

    // 3. Reasoning / Thinking model response (e.g. DeepSeek R1)
    if model.contains("r1") {
        return Json(json!({
            "id": "chatcmpl-reasoning-test",
            "object": "chat.completion",
            "created": 1790900000,
            "model": model,
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": "The solution is x = 5.",
                    "reasoning_content": "Step 1: 2x + 5 = 15\nStep 2: 2x = 10\nStep 3: x = 5"
                },
                "finish_reason": "stop"
            }],
            "usage": {"prompt_tokens": 20, "completion_tokens": 30, "total_tokens": 50}
        }))
        .into_response();
    }

    // 4. Standard completion response
    Json(json!({
        "id": "chatcmpl-std-test",
        "object": "chat.completion",
        "created": 1790900000,
        "model": model,
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": format!("Response from model {model}")
            },
            "finish_reason": "stop"
        }],
        "usage": {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20}
    }))
    .into_response()
}

struct E2eMockServer {
    base_url: String,
    calls: Arc<Mutex<Vec<RecordedCall>>>,
    _fail_first_call: Arc<Mutex<bool>>,
}

async fn start_e2e_mock() -> E2eMockServer {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let fail_first_call = Arc::new(Mutex::new(true));

    let app = Router::new()
        .fallback(e2e_mock_handler)
        .with_state(E2eMockState {
            calls: calls.clone(),
            fail_first_call: fail_first_call.clone(),
        });

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind mock port");
    let address = listener.local_addr().expect("mock local address");
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve mock");
    });

    E2eMockServer {
        base_url: format!("http://{address}"),
        calls,
        _fail_first_call: fail_first_call,
    }
}

async fn seed_e2e_environment(db: &PgPool, upstream_url: &str) {
    // Org & Project
    sqlx::query("INSERT INTO orgs (id, name) VALUES ($1, $2)")
        .bind(ORG_ID)
        .bind("E2E Test Org")
        .execute(db)
        .await
        .expect("insert org");

    sqlx::query(
        "INSERT INTO projects (id, org_id, name, rpm_limit, daily_spend_limit) VALUES ($1, $2, $3, 100, 100.0)",
    )
    .bind(PROJECT_ID)
    .bind(ORG_ID)
    .bind("E2E Test Project")
    .execute(db)
    .await
    .expect("insert project");

    // Provider Account
    sqlx::query(
        "INSERT INTO provider_accounts (id, name, provider_type, protocol, base_url, api_key, status, org_id)
         VALUES ($1, $2, 'openai', 'openai', $3, 'sk-test-provider', 'active', $4)",
    )
    .bind(ACCOUNT_ID)
    .bind("E2E Upstream")
    .bind(upstream_url)
    .bind(ORG_ID)
    .execute(db)
    .await
    .expect("insert provider account");

    // Endpoints
    // 1. R1 reasoning endpoint
    sqlx::query(
        "INSERT INTO endpoints (id, account_id, name, upstream_model_id, enabled, priority, weight, health_status)
         VALUES ('ep_r1', $1, 'DeepSeek R1', 'deepseek-r1-free', TRUE, 10, 10, 'healthy')",
    )
    .bind(ACCOUNT_ID)
    .execute(db)
    .await
    .expect("insert ep_r1");

    // 2. Chat tools endpoint
    sqlx::query(
        "INSERT INTO endpoints (id, account_id, name, upstream_model_id, enabled, priority, weight, health_status)
         VALUES ('ep_chat', $1, 'DeepSeek Chat', 'deepseek-chat-free', TRUE, 10, 10, 'healthy')",
    )
    .bind(ACCOUNT_ID)
    .execute(db)
    .await
    .expect("insert ep_chat");

    // 3. GLM endpoint
    sqlx::query(
        "INSERT INTO endpoints (id, account_id, name, upstream_model_id, enabled, priority, weight, health_status)
         VALUES ('ep_glm', $1, 'GLM-4', 'glm-4-free', TRUE, 10, 10, 'healthy')",
    )
    .bind(ACCOUNT_ID)
    .execute(db)
    .await
    .expect("insert ep_glm");

    // 4. Failing endpoint (priority 100 in auto pool)
    sqlx::query(
        "INSERT INTO endpoints (id, account_id, name, upstream_model_id, enabled, priority, weight, health_status)
         VALUES ('ep_failing', $1, 'Failing Primary', 'failing-model', TRUE, 100, 10, 'healthy')",
    )
    .bind(ACCOUNT_ID)
    .execute(db)
    .await
    .expect("insert ep_failing");

    // 5. Success fallback endpoint (priority 50 in auto pool)
    sqlx::query(
        "INSERT INTO endpoints (id, account_id, name, upstream_model_id, enabled, priority, weight, health_status)
         VALUES ('ep_fallback', $1, 'Backup Fallback', 'backup-model', TRUE, 50, 10, 'healthy')",
    )
    .bind(ACCOUNT_ID)
    .execute(db)
    .await
    .expect("insert ep_fallback");

    // Pools
    sqlx::query("INSERT INTO model_pools (id, org_id, name, strategy, enabled) VALUES ('pool_r1', $1, 'pool_r1', 'priority', TRUE)")
        .bind(ORG_ID).execute(db).await.unwrap();
    sqlx::query("INSERT INTO model_pools (id, org_id, name, strategy, enabled) VALUES ('pool_chat', $1, 'pool_chat', 'priority', TRUE)")
        .bind(ORG_ID).execute(db).await.unwrap();
    sqlx::query("INSERT INTO model_pools (id, org_id, name, strategy, enabled) VALUES ('pool_glm', $1, 'pool_glm', 'priority', TRUE)")
        .bind(ORG_ID).execute(db).await.unwrap();
    sqlx::query("INSERT INTO model_pools (id, org_id, name, strategy, enabled) VALUES ('pool_auto', $1, 'pool_auto', 'fallback', TRUE)")
        .bind(ORG_ID).execute(db).await.unwrap();

    // Pool Endpoints
    sqlx::query("INSERT INTO model_pool_endpoints (pool_id, endpoint_id, priority, weight) VALUES ('pool_r1', 'ep_r1', 10, 10)").execute(db).await.unwrap();
    sqlx::query("INSERT INTO model_pool_endpoints (pool_id, endpoint_id, priority, weight) VALUES ('pool_chat', 'ep_chat', 10, 10)").execute(db).await.unwrap();
    sqlx::query("INSERT INTO model_pool_endpoints (pool_id, endpoint_id, priority, weight) VALUES ('pool_glm', 'ep_glm', 10, 10)").execute(db).await.unwrap();
    // Auto pool with fallback order: ep_failing (100) -> ep_fallback (50)
    sqlx::query("INSERT INTO model_pool_endpoints (pool_id, endpoint_id, priority, weight) VALUES ('pool_auto', 'ep_failing', 100, 10)").execute(db).await.unwrap();
    sqlx::query("INSERT INTO model_pool_endpoints (pool_id, endpoint_id, priority, weight) VALUES ('pool_auto', 'ep_fallback', 50, 10)").execute(db).await.unwrap();

    // Virtual Models (Upsert pointing to our test pools)
    sqlx::query("INSERT INTO virtual_models (id, pool_id, name, enabled) VALUES ('vm_r1', 'pool_r1', $1, TRUE) ON CONFLICT (name) DO UPDATE SET pool_id = 'pool_r1'").bind(MODEL_R1).execute(db).await.unwrap();
    sqlx::query("INSERT INTO virtual_models (id, pool_id, name, enabled) VALUES ('vm_chat', 'pool_chat', $1, TRUE) ON CONFLICT (name) DO UPDATE SET pool_id = 'pool_chat'").bind(MODEL_CHAT).execute(db).await.unwrap();
    sqlx::query("INSERT INTO virtual_models (id, pool_id, name, enabled) VALUES ('vm_glm', 'pool_glm', $1, TRUE) ON CONFLICT (name) DO UPDATE SET pool_id = 'pool_glm'").bind(MODEL_GLM).execute(db).await.unwrap();
    sqlx::query("INSERT INTO virtual_models (id, pool_id, name, enabled) VALUES ('vm_auto', 'pool_auto', $1, TRUE) ON CONFLICT (name) DO UPDATE SET pool_id = 'pool_auto'").bind(MODEL_AUTO).execute(db).await.unwrap();

    let vm_r1_id: String = sqlx::query_scalar("SELECT id FROM virtual_models WHERE name = $1")
        .bind(MODEL_R1)
        .fetch_one(db)
        .await
        .unwrap();
    let vm_chat_id: String = sqlx::query_scalar("SELECT id FROM virtual_models WHERE name = $1")
        .bind(MODEL_CHAT)
        .fetch_one(db)
        .await
        .unwrap();
    let vm_glm_id: String = sqlx::query_scalar("SELECT id FROM virtual_models WHERE name = $1")
        .bind(MODEL_GLM)
        .fetch_one(db)
        .await
        .unwrap();
    let vm_auto_id: String = sqlx::query_scalar("SELECT id FROM virtual_models WHERE name = $1")
        .bind(MODEL_AUTO)
        .fetch_one(db)
        .await
        .unwrap();

    // Project grants
    sqlx::query("INSERT INTO project_model_grants (project_id, virtual_model_id) VALUES ($1, $2) ON CONFLICT DO NOTHING").bind(PROJECT_ID).bind(&vm_r1_id).execute(db).await.unwrap();
    sqlx::query("INSERT INTO project_model_grants (project_id, virtual_model_id) VALUES ($1, $2) ON CONFLICT DO NOTHING").bind(PROJECT_ID).bind(&vm_chat_id).execute(db).await.unwrap();
    sqlx::query("INSERT INTO project_model_grants (project_id, virtual_model_id) VALUES ($1, $2) ON CONFLICT DO NOTHING").bind(PROJECT_ID).bind(&vm_glm_id).execute(db).await.unwrap();
    sqlx::query("INSERT INTO project_model_grants (project_id, virtual_model_id) VALUES ($1, $2) ON CONFLICT DO NOTHING").bind(PROJECT_ID).bind(&vm_auto_id).execute(db).await.unwrap();

    // Seed Key 1 (Developer key with access to R1, Chat, and Auto)
    sqlx::query(
        "INSERT INTO api_keys (id, project_id, name, key_hash, key_prefix, enabled)
         VALUES ($1, $2, 'Dev Key All', $3, 'sg-key1', TRUE)",
    )
    .bind(KEY1_ID)
    .bind(PROJECT_ID)
    .bind(hash_token(KEY1_TOKEN))
    .execute(db)
    .await
    .unwrap();

    sqlx::query("INSERT INTO api_key_model_grants (api_key_id, virtual_model_id) VALUES ($1, $2) ON CONFLICT DO NOTHING").bind(KEY1_ID).bind(&vm_r1_id).execute(db).await.unwrap();
    sqlx::query("INSERT INTO api_key_model_grants (api_key_id, virtual_model_id) VALUES ($1, $2) ON CONFLICT DO NOTHING").bind(KEY1_ID).bind(&vm_chat_id).execute(db).await.unwrap();

    // Seed Key 2 (Restricted key: ONLY GLM-4)
    sqlx::query(
        "INSERT INTO api_keys (id, project_id, name, key_hash, key_prefix, enabled)
         VALUES ($1, $2, 'Restricted Key GLM', $3, 'sg-key2', TRUE)",
    )
    .bind(KEY2_ID)
    .bind(PROJECT_ID)
    .bind(hash_token(KEY2_TOKEN))
    .execute(db)
    .await
    .unwrap();

    sqlx::query("INSERT INTO api_key_model_grants (api_key_id, virtual_model_id) VALUES ($1, $2) ON CONFLICT DO NOTHING").bind(KEY2_ID).bind(&vm_glm_id).execute(db).await.unwrap();

    // Seed Key 3 (Auto Key: with smartgate/auto fallback)
    sqlx::query(
        "INSERT INTO api_keys (id, project_id, name, key_hash, key_prefix, enabled)
         VALUES ($1, $2, 'Auto Key', $3, 'sg-key3', TRUE)",
    )
    .bind(KEY3_ID)
    .bind(PROJECT_ID)
    .bind(hash_token(KEY3_TOKEN))
    .execute(db)
    .await
    .unwrap();

    sqlx::query("INSERT INTO api_key_model_grants (api_key_id, virtual_model_id) VALUES ($1, $2) ON CONFLICT DO NOTHING").bind(KEY3_ID).bind(&vm_auto_id).execute(db).await.unwrap();
}

async fn create_test_app_state(database_url: String, db: PgPool) -> Arc<AppState> {
    let metrics = Arc::new(DashMap::new());
    let pools = Arc::new(DashMap::new());
    let pool_members = Arc::new(DashMap::new());
    let profiles = Arc::new(DashMap::new());
    let quotas = Arc::new(QuotaLimiter::new());
    let hints = Arc::new(DashMap::new());

    let hooks = Arc::new(SmartGateHooks {
        db: db.clone(),
        metrics: metrics.clone(),
        quotas: quotas.clone(),
        profiles: profiles.clone(),
    });
    let feedback = Arc::new(SmartGateFeedbackProvider {
        metrics: metrics.clone(),
        pools: pools.clone(),
        pool_members: pool_members.clone(),
        profiles: profiles.clone(),
        hints: hints.clone(),
    });
    let engine = Arc::new(
        UniGatewayEngine::builder()
            .with_builtin_http_drivers()
            .with_hooks(hooks)
            .with_routing_feedback_provider(feedback.clone())
            .build()
            .expect("build UniGateway engine"),
    );
    crate::sync::sync_all_pools(&engine, &db, &pools, &pool_members, &profiles, &metrics)
        .await
        .expect("sync pools");
    let warm_store = Arc::new(
        WarmStore::try_with_config(&WarmConfig::default()).expect("initialize Warm store"),
    );

    Arc::new(AppState {
        config: Config {
            addr: "127.0.0.1:0".parse().unwrap(),
            database_url,
            admin_token: "test-admin-token".to_string(),
            cors_allowed_origins: Vec::new(),
            resend_api_key: None,
            resend_from_email: None,
            warm: WarmConfig::default(),
            shadow: ShadowConfig::default(),
        },
        db,
        metrics,
        pools,
        pool_members,
        profiles,
        quotas,
        hints,
        feedback,
        engine,
        warm_store,
        shadow_semaphore: Arc::new(tokio::sync::Semaphore::new(3)),
    })
}

async fn get_auth_for_key(db: &PgPool, key_id: &str) -> AuthContext {
    let project = sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE id = $1")
        .bind(PROJECT_ID)
        .fetch_one(db)
        .await
        .unwrap();
    let api_key = sqlx::query_as::<_, ApiKey>("SELECT * FROM api_keys WHERE id = $1")
        .bind(key_id)
        .fetch_one(db)
        .await
        .unwrap();
    AuthContext { project, api_key }
}

async fn execute_chat_request(
    state: &Arc<AppState>,
    auth: AuthContext,
    payload: Value,
) -> (StatusCode, Value) {
    let response = crate::api::proxy::chat_completions(
        State(state.clone()),
        auth,
        HeaderMap::new(),
        Json(payload),
    )
    .await;

    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    let json_val = serde_json::from_slice(&bytes).unwrap_or(json!({
        "raw_text": String::from_utf8_lossy(&bytes).into_owned()
    }));
    (status, json_val)
}

fn unique_test_schema() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("sg_e2e_{}_{}", std::process::id(), nanos)
}

#[tokio::test]
async fn test_e2e_models_keys_thinking_and_tools() {
    let database_url = match std::env::var(TEST_DATABASE_URL_ENV) {
        Ok(url) if !url.trim().is_empty() => url,
        _ => {
            eprintln!("skipping e2e test: set {TEST_DATABASE_URL_ENV} to run");
            return;
        }
    };

    let schema = unique_test_schema();
    let admin = PgPool::connect(&database_url).await.unwrap();
    sqlx::query(&format!("CREATE SCHEMA \"{schema}\""))
        .execute(&admin)
        .await
        .unwrap();
    admin.close().await;

    let separator = if database_url.contains('?') { '&' } else { '?' };
    let scoped_url = format!("{database_url}{separator}options=-c%20search_path%3D{schema}");
    let db = crate::db::init_db(&scoped_url).await.unwrap();

    let mock = start_e2e_mock().await;
    seed_e2e_environment(&db, &mock.base_url).await;
    let state = create_test_app_state(scoped_url, db.clone()).await;

    let auth_dev = get_auth_for_key(&db, KEY1_ID).await;
    let auth_restricted = get_auth_for_key(&db, KEY2_ID).await;
    let auth_auto = get_auth_for_key(&db, KEY3_ID).await;

    // =========================================================================
    // 1. Multiple API Keys and Model Authorization Verification
    // =========================================================================
    // Dev key calling R1 -> 200 OK
    let (status, resp) = execute_chat_request(
        &state,
        auth_dev.clone(),
        json!({
            "model": MODEL_R1,
            "messages": [{"role": "user", "content": "What is 2x+5=15?"}]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "Dev key should access R1: {resp}");

    // Dev key calling GLM-4 (not granted to dev key and no auto grant) -> 403 Forbidden
    let (status, _) = execute_chat_request(
        &state,
        auth_dev.clone(),
        json!({
            "model": MODEL_GLM,
            "messages": [{"role": "user", "content": "Hi"}]
        }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "Dev key should not access ungranted GLM"
    );

    // Restricted key calling GLM-4 -> 200 OK
    let (status, resp) = execute_chat_request(
        &state,
        auth_restricted.clone(),
        json!({
            "model": MODEL_GLM,
            "messages": [{"role": "user", "content": "Hello"}]
        }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "Restricted key should access GLM-4: {resp}"
    );

    // Restricted key calling R1 -> 403 Forbidden
    let (status, _) = execute_chat_request(
        &state,
        auth_restricted.clone(),
        json!({
            "model": MODEL_R1,
            "messages": [{"role": "user", "content": "Hi"}]
        }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "Restricted key should not access R1"
    );

    // =========================================================================
    // 2. Reasoning / Thinking Model Verification (DeepSeek R1)
    // =========================================================================
    let (status, r1_resp) = execute_chat_request(
        &state,
        auth_dev.clone(),
        json!({
            "model": MODEL_R1,
            "messages": [{"role": "user", "content": "Solve 2x+5=15 with detailed thinking"}]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let choice = &r1_resp["choices"][0]["message"];
    assert!(
        choice.get("reasoning_content").is_some(),
        "Reasoning model response must preserve reasoning_content: {r1_resp}"
    );
    let reasoning = choice["reasoning_content"].as_str().unwrap();
    assert!(
        reasoning.contains("Step 1: 2x + 5 = 15"),
        "Thinking trace must be intact: {reasoning}"
    );
    assert_eq!(
        choice["content"].as_str().unwrap(),
        "The solution is x = 5."
    );

    // =========================================================================
    // 3. Tools / Function Calling Verification
    // =========================================================================
    let tools_payload = json!({
        "model": MODEL_CHAT,
        "messages": [{"role": "user", "content": "What's the weather in Tokyo?"}],
        "tools": [{
            "type": "function",
            "function": {
                "name": "get_current_weather",
                "description": "Get current weather in a location",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "location": {"type": "string"}
                    },
                    "required": ["location"]
                }
            }
        }],
        "tool_choice": "auto"
    });

    let (status, tool_resp) = execute_chat_request(&state, auth_dev.clone(), tools_payload).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "Tools request must succeed: {tool_resp}"
    );
    let tool_choice = &tool_resp["choices"][0]["message"];
    assert!(
        tool_choice.get("tool_calls").is_some(),
        "Tools response must contain tool_calls: {tool_resp}"
    );
    let tool_call = &tool_choice["tool_calls"][0];
    assert_eq!(tool_call["type"], "function");
    assert_eq!(tool_call["function"]["name"], "get_current_weather");
    assert_eq!(
        tool_call["function"]["arguments"],
        "{\"location\":\"Tokyo\"}"
    );

    // =========================================================================
    // 4. Auto Model (`smartgate/auto`) and Automatic Failover Verification
    // =========================================================================
    // Primary endpoint (failing-model) fails with 429 on first try.
    // The fallback strategy must seamlessly route to ep_fallback (backup-model) and return 200.
    let (status, auto_resp) = execute_chat_request(
        &state,
        auth_auto.clone(),
        json!({
            "model": MODEL_AUTO,
            "messages": [{"role": "user", "content": "Test auto failover"}]
        }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "smartgate/auto must automatically fall back to healthy backup endpoint on failure: {auto_resp}"
    );
    let auto_content = auto_resp["choices"][0]["message"]["content"]
        .as_str()
        .unwrap();
    assert!(
        auto_content.contains("backup-model"),
        "Failover response must be from the backup model: {auto_content}"
    );

    // Verify mock server recorded all expected requests
    {
        let recorded_calls = mock.calls.lock().unwrap();
        assert!(
            recorded_calls.len() >= 4,
            "Mock must have recorded all requests"
        );
        assert!(recorded_calls
            .iter()
            .all(|c| !c.path.is_empty() && c.body.is_object()));
    }

    // Clean up test schema
    sqlx::query(&format!("DROP SCHEMA \"{schema}\" CASCADE"))
        .execute(&db)
        .await
        .unwrap();
    db.close().await;
}
