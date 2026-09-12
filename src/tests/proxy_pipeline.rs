//! End-to-end regression coverage for the hot proxy request path.
//!
//! `chat_completions` is the entry point every client request takes, but exercising
//! it needs a real PostgreSQL database and a reachable upstream. This test builds the
//! same `AppState` the server builds, points one seeded endpoint at an in-process mock
//! upstream, and verifies the observable contract: the upstream call, the usage row,
//! priced/unpriced cost accounting, and model authorization.
//!
//! When `SMARTGATE_TEST_DATABASE_URL` is unset the test prints a one-line note and
//! returns, so `cargo test --lib` keeps working for developers without a database.

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
const MOCK_REPLY: &str = "pong from mock upstream";
const PROVIDER_KEY: &str = "sk-mock-provider-key";
const STRATEGY: &str = "capability_aware";

const ORG_ID: &str = "org-proxy-test";
const PROJECT_ID: &str = "project-proxy-test";
const API_KEY_ID: &str = "key-proxy-test";
const API_TOKEN: &str = "sg-proxy-test-token";
const ACCOUNT_ID: &str = "account-proxy-test";
const ENDPOINT_ID: &str = "endpoint-proxy-test";
const POOL_ID: &str = "pool-proxy-test";
const VIRTUAL_MODEL_ID: &str = "vm-proxy-test";
const VIRTUAL_MODEL_NAME: &str = "mock-virtual-model";
const UPSTREAM_MODEL_ID: &str = "mock-model";

/// One request observed by the mock upstream.
#[derive(Debug, Clone)]
struct RecordedRequest {
    authorization: Option<String>,
    body: Value,
}

#[derive(Clone)]
struct MockUpstreamState {
    requests: Arc<Mutex<Vec<RecordedRequest>>>,
}

struct MockUpstream {
    base_url: String,
    requests: Arc<Mutex<Vec<RecordedRequest>>>,
}

impl MockUpstream {
    fn recorded(&self) -> Vec<RecordedRequest> {
        self.requests
            .lock()
            .expect("mock upstream request lock")
            .clone()
    }

    fn clear(&self) {
        self.requests
            .lock()
            .expect("mock upstream request lock")
            .clear();
    }
}

/// Record the inbound request, then answer with a fixed OpenAI chat completion.
async fn mock_upstream_handler(
    State(state): State<MockUpstreamState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let authorization = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let parsed = serde_json::from_slice(&body).unwrap_or(Value::Null);
    state
        .requests
        .lock()
        .expect("mock upstream request lock")
        .push(RecordedRequest {
            authorization,
            body: parsed,
        });

    Json(json!({
        "choices": [{"message": {"role": "assistant", "content": MOCK_REPLY}}],
        "usage": {"prompt_tokens": 7, "completion_tokens": 5, "total_tokens": 12}
    }))
    .into_response()
}

/// Bind the mock upstream to an OS-assigned port and start serving in the background.
async fn start_mock_upstream() -> MockUpstream {
    let requests = Arc::new(Mutex::new(Vec::new()));
    let app = Router::new()
        .fallback(mock_upstream_handler)
        .with_state(MockUpstreamState {
            requests: requests.clone(),
        });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind mock upstream on an ephemeral port");
    let address = listener.local_addr().expect("mock upstream local address");
    tokio::spawn(async move {
        axum::serve(listener, app)
            .await
            .expect("serve mock upstream");
    });

    MockUpstream {
        base_url: format!("http://{address}"),
        requests,
    }
}

/// Build `AppState` the way `server::run` does, then sync the seeded pool config.
async fn build_app_state(database_url: String, db: PgPool) -> Arc<AppState> {
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
        .expect("sync pools from the seeded database");
    let warm_store = Arc::new(
        WarmStore::try_with_config(&WarmConfig::default()).expect("initialize Warm store"),
    );

    Arc::new(AppState {
        config: Config {
            addr: "127.0.0.1:0".parse().expect("test listen address"),
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

/// Seed one org/project/key/account/endpoint/pool/model/grants chain.
async fn seed(db: &PgPool, upstream_base_url: &str) {
    sqlx::query("INSERT INTO orgs (id, name) VALUES ($1, $2)")
        .bind(ORG_ID)
        .bind("Proxy test org")
        .execute(db)
        .await
        .expect("insert org");

    sqlx::query("INSERT INTO projects (id, org_id, name) VALUES ($1, $2, $3)")
        .bind(PROJECT_ID)
        .bind(ORG_ID)
        .bind("Proxy test project")
        .execute(db)
        .await
        .expect("insert project");

    sqlx::query(
        "INSERT INTO api_keys (id, project_id, name, key_hash, key_prefix, enabled)
         VALUES ($1, $2, $3, $4, $5, TRUE)",
    )
    .bind(API_KEY_ID)
    .bind(PROJECT_ID)
    .bind("Proxy test key")
    .bind(hash_token(API_TOKEN))
    .bind("sg-proxy")
    .execute(db)
    .await
    .expect("insert api key");

    sqlx::query(
        "INSERT INTO provider_accounts
             (id, name, provider_type, protocol, base_url, api_key, status, org_id)
         VALUES ($1, $2, 'openai', 'openai', $3, $4, 'active', $5)",
    )
    .bind(ACCOUNT_ID)
    .bind("Mock upstream account")
    .bind(upstream_base_url)
    .bind(PROVIDER_KEY)
    .bind(ORG_ID)
    .execute(db)
    .await
    .expect("insert provider account");

    sqlx::query(
        "INSERT INTO model_pools (id, name, strategy, enabled, org_id)
         VALUES ($1, $2, $3, TRUE, $4)",
    )
    .bind(POOL_ID)
    .bind("Proxy test pool")
    .bind(STRATEGY)
    .bind(ORG_ID)
    .execute(db)
    .await
    .expect("insert model pool");

    sqlx::query(
        "INSERT INTO endpoints
             (id, account_id, name, upstream_model_id, enabled, priority, weight,
              health_status, input_price_per_1m, output_price_per_1m,
              capability_score, supports_tools, context_length)
         VALUES ($1, $2, $3, $4, TRUE, 1, 1, 'healthy', 0.5, 1.5, 0.8, 1, 128000)",
    )
    .bind(ENDPOINT_ID)
    .bind(ACCOUNT_ID)
    .bind("Mock endpoint")
    .bind(UPSTREAM_MODEL_ID)
    .execute(db)
    .await
    .expect("insert endpoint");

    sqlx::query(
        "INSERT INTO model_pool_endpoints (pool_id, endpoint_id, priority, weight)
         VALUES ($1, $2, 1, 1)",
    )
    .bind(POOL_ID)
    .bind(ENDPOINT_ID)
    .execute(db)
    .await
    .expect("insert pool endpoint");

    sqlx::query(
        "INSERT INTO virtual_models (id, pool_id, name, enabled) VALUES ($1, $2, $3, TRUE)",
    )
    .bind(VIRTUAL_MODEL_ID)
    .bind(POOL_ID)
    .bind(VIRTUAL_MODEL_NAME)
    .execute(db)
    .await
    .expect("insert virtual model");

    sqlx::query("INSERT INTO project_model_grants (project_id, virtual_model_id) VALUES ($1, $2)")
        .bind(PROJECT_ID)
        .bind(VIRTUAL_MODEL_ID)
        .execute(db)
        .await
        .expect("insert project model grant");
}

async fn auth_context(db: &PgPool) -> AuthContext {
    let project = sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE id = $1")
        .bind(PROJECT_ID)
        .fetch_one(db)
        .await
        .expect("seeded project");
    let api_key = sqlx::query_as::<_, ApiKey>("SELECT * FROM api_keys WHERE id = $1")
        .bind(API_KEY_ID)
        .fetch_one(db)
        .await
        .expect("seeded api key");
    AuthContext { project, api_key }
}

/// Invoke the proxy handler exactly the way the router does, then read the body.
async fn call_chat_completions(
    state: &Arc<AppState>,
    auth: AuthContext,
    model: &str,
) -> (StatusCode, String) {
    let payload = json!({
        "model": model,
        "messages": [{"role": "user", "content": "ping"}],
        "stream": false,
    });
    let response = crate::api::proxy::chat_completions(
        State(state.clone()),
        auth,
        HeaderMap::new(),
        Json(payload),
    )
    .await;
    let status = response.status();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read proxy response body");
    (status, String::from_utf8_lossy(&body).into_owned())
}

#[derive(sqlx::FromRow)]
struct UsageRow {
    metadata: Option<String>,
    estimated_cost: f64,
    input_price_snapshot: f64,
    output_price_snapshot: f64,
}

async fn latest_usage_row(db: &PgPool, pricing_source: &str) -> UsageRow {
    sqlx::query_as::<_, UsageRow>(
        "SELECT metadata, estimated_cost, input_price_snapshot, output_price_snapshot
         FROM usage_logs
         WHERE key_id = $1 AND pricing_source = $2
         ORDER BY timestamp DESC
         LIMIT 1",
    )
    .bind(API_KEY_ID)
    .bind(pricing_source)
    .fetch_one(db)
    .await
    .expect("usage_logs row for the seeded key")
}

fn usage_metadata(row: &UsageRow) -> Value {
    serde_json::from_str(row.metadata.as_deref().expect("usage_logs metadata")).expect("metadata")
}

/// A unique schema name so a shared test database cannot be clobbered by another run.
fn unique_schema_name() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock after the Unix epoch")
        .as_nanos();
    format!("sg_proxy_test_{}_{}", std::process::id(), nanos)
}

/// Point the connection's `search_path` at the isolated schema so `init_db` migrates there.
fn with_search_path(database_url: &str, schema: &str) -> String {
    let separator = if database_url.contains('?') { '&' } else { '?' };
    format!("{database_url}{separator}options=-c%20search_path%3D{schema}")
}

async fn drop_schema(db: &PgPool, schema: &str) {
    sqlx::query(&format!("DROP SCHEMA \"{schema}\" CASCADE"))
        .execute(db)
        .await
        .expect("drop isolated test schema");
}

#[tokio::test]
async fn chat_completions_proxies_to_the_pool_and_records_usage() {
    let database_url = match std::env::var(TEST_DATABASE_URL_ENV) {
        Ok(url) if !url.trim().is_empty() => url,
        _ => {
            eprintln!(
                "skipping proxy pipeline test: set {TEST_DATABASE_URL_ENV} to a disposable PostgreSQL URL to run it"
            );
            return;
        }
    };

    let schema = unique_schema_name();
    let admin = PgPool::connect(&database_url)
        .await
        .expect("connect to the test database");
    sqlx::query(&format!("CREATE SCHEMA \"{schema}\""))
        .execute(&admin)
        .await
        .expect("create the isolated test schema");
    admin.close().await;

    let scoped_url = with_search_path(&database_url, &schema);
    let db = crate::db::init_db(&scoped_url)
        .await
        .expect("run migrations in the isolated schema");

    let upstream = start_mock_upstream().await;
    seed(&db, &upstream.base_url).await;

    // --- Priced endpoint: happy path, upstream fan-out and usage attribution ---
    let state = build_app_state(scoped_url.clone(), db.clone()).await;
    let (status, body) =
        call_chat_completions(&state, auth_context(&db).await, VIRTUAL_MODEL_NAME).await;
    assert_eq!(status, StatusCode::OK, "proxy response body: {body}");
    assert!(
        body.contains(MOCK_REPLY),
        "proxy must return the upstream completion, got: {body}"
    );

    let expected_authorization = format!("Bearer {PROVIDER_KEY}");
    let recorded = upstream.recorded();
    assert_eq!(recorded.len(), 1, "the upstream must see exactly one call");
    assert_eq!(
        recorded[0].authorization.as_deref(),
        Some(expected_authorization.as_str()),
        "the upstream must receive the provider account credential"
    );
    assert_eq!(
        recorded[0].body.get("model").and_then(Value::as_str),
        Some(UPSTREAM_MODEL_ID),
        "the upstream must receive the endpoint's upstream model id"
    );

    let priced = latest_usage_row(&db, "configured_endpoint").await;
    let metadata = usage_metadata(&priced);
    assert_eq!(metadata.get("org_id").and_then(Value::as_str), Some(ORG_ID));
    assert_eq!(
        metadata.get("project_id").and_then(Value::as_str),
        Some(PROJECT_ID)
    );
    assert_eq!(
        metadata.get("pool_id").and_then(Value::as_str),
        Some(POOL_ID)
    );
    assert_eq!(
        metadata.get("routing_strategy").and_then(Value::as_str),
        Some(STRATEGY)
    );
    assert!(
        priced.estimated_cost > 0.0,
        "a priced endpoint must record a non-zero estimated cost"
    );

    // --- Authorization: an ungranted model never reaches the upstream ---
    let (status, _) =
        call_chat_completions(&state, auth_context(&db).await, "not-a-granted-model").await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        upstream.recorded().len(),
        1,
        "an unauthorized model must not reach the upstream"
    );

    // --- Unpriced endpoint: still 200, but cost is 0 and provenance is recorded ---
    sqlx::query(
        "UPDATE endpoints SET input_price_per_1m = NULL, output_price_per_1m = NULL WHERE id = $1",
    )
    .bind(ENDPOINT_ID)
    .execute(&db)
    .await
    .expect("clear endpoint prices");

    upstream.clear();
    let unpriced_state = build_app_state(scoped_url, db.clone()).await;
    let (status, body) =
        call_chat_completions(&unpriced_state, auth_context(&db).await, VIRTUAL_MODEL_NAME).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "unpriced proxy response body: {body}"
    );
    assert!(
        body.contains(MOCK_REPLY),
        "an unpriced endpoint must still proxy the upstream completion, got: {body}"
    );
    assert_eq!(
        upstream.recorded().len(),
        1,
        "each authorized request must fan out to exactly one upstream call"
    );

    let unpriced = latest_usage_row(&db, "unpriced").await;
    let metadata = usage_metadata(&unpriced);
    assert_eq!(
        metadata.get("pricing_source").and_then(Value::as_str),
        Some("unpriced")
    );
    assert_eq!(unpriced.estimated_cost, 0.0);
    assert_eq!(unpriced.input_price_snapshot, 0.0);
    assert_eq!(unpriced.output_price_snapshot, 0.0);

    drop_schema(&db, &schema).await;
    db.close().await;
}
