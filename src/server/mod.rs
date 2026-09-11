use crate::config::{AppState, Config};
use crate::db::init_db;
use crate::quota::QuotaLimiter;
use crate::routing::SmartGateFeedbackProvider;
use crate::usage::SmartGateHooks;
use axum::{
    extract::State,
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Json, Response},
    routing::{delete, get, post},
    Router,
};
use dashmap::DashMap;
use std::sync::Arc;
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use unigateway_sdk::core::UniGatewayEngine;

/// Global handle to the Prometheus recorder, installed when METRICS_ENABLED is on (default).
static METRICS_HANDLE: once_cell::sync::OnceCell<metrics_exporter_prometheus::PrometheusHandle> =
    once_cell::sync::OnceCell::new();

fn metrics_enabled() -> bool {
    std::env::var("METRICS_ENABLED")
        .map(|v| v != "0" && !v.eq_ignore_ascii_case("false"))
        .unwrap_or(true)
}

fn init_metrics() -> Option<metrics_exporter_prometheus::PrometheusHandle> {
    if !metrics_enabled() {
        tracing::info!("Prometheus metrics disabled (METRICS_ENABLED)");
        return None;
    }
    let recorder = metrics_exporter_prometheus::PrometheusBuilder::new().build_recorder();
    let handle = recorder.handle();
    metrics::set_global_recorder(recorder).expect("failed to install Prometheus metrics recorder");
    tracing::info!("Prometheus metrics enabled at /metrics");
    Some(handle)
}

async fn metrics_handler() -> Response {
    match METRICS_HANDLE.get() {
        Some(handle) => (
            StatusCode::OK,
            [("content-type", "text/plain; version=0.0.4; charset=utf-8")],
            handle.render(),
        )
            .into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "metrics disabled"})),
        )
            .into_response(),
    }
}

/// Records request count and latency histogram per method and matched path pattern.
async fn track_http_metrics(req: axum::extract::Request, next: Next) -> Response {
    let method = req.method().clone();
    let path = req
        .extensions()
        .get::<axum::extract::MatchedPath>()
        .map(|p| p.as_str().to_string())
        .unwrap_or_else(|| req.uri().path().to_string());
    if path == "/metrics" {
        return next.run(req).await;
    }
    let start = std::time::Instant::now();
    let response = next.run(req).await;
    let labels = [
        ("method", method.to_string()),
        ("path", path),
        ("status", response.status().as_u16().to_string()),
    ];
    metrics::counter!("http_requests_total", &labels).increment(1);
    metrics::histogram!("http_request_duration_seconds", &labels)
        .record(start.elapsed().as_secs_f64());
    response
}

async fn health_check(State(state): State<Arc<AppState>>) -> Response {
    // Cheap liveness probe that also verifies DB connectivity.
    let db_ok = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        sqlx::query("SELECT 1").execute(&state.db),
    )
    .await
    .map(|r| r.is_ok())
    .unwrap_or(false);

    if db_ok {
        (StatusCode::OK, Json(serde_json::json!({"status": "ok"}))).into_response()
    } else {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"status": "unavailable", "reason": "database"})),
        )
            .into_response()
    }
}

pub async fn run(config: Config) -> anyhow::Result<()> {
    let db = init_db(&config.database_url).await?;

    if let Some(handle) = init_metrics() {
        METRICS_HANDLE.set(handle).ok();
    }

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

    let feedback_provider = Arc::new(SmartGateFeedbackProvider {
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
            .with_routing_feedback_provider(feedback_provider.clone())
            .build()
            .map_err(|e| anyhow::anyhow!("Failed to build UniGateway engine: {}", e))?,
    );

    crate::sync::sync_all_pools(&engine, &db, &pools, &pool_members, &profiles, &metrics).await?;

    // Spawn background sync worker for OpenRouter market catalog (every 6 hours)
    crate::sync::openrouter::spawn_openrouter_sync_worker(
        db.clone(),
        std::time::Duration::from_secs(6 * 3600),
    );

    let warm_store = Arc::new(
        crate::warm::WarmStore::try_with_config(&config.warm)
            .map_err(|error| anyhow::anyhow!("failed to initialize Warm store: {error}"))?,
    );
    if let Some(interval) = config.warm.cleanup_interval() {
        let cleanup_store = warm_store.clone();
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(interval);
            loop {
                ticker.tick().await;
                match cleanup_store.purge_expired().await {
                    Ok(removed) if removed > 0 => {
                        tracing::debug!(removed, "purged expired Warm sessions");
                    }
                    Ok(_) => {}
                    Err(error) => {
                        tracing::warn!(error = %error.message(), "failed to purge expired Warm sessions");
                    }
                }
            }
        });
    }

    let app_state = Arc::new(AppState {
        config: config.clone(),
        db,
        metrics,
        pools,
        pool_members,
        profiles,
        quotas,
        hints,
        feedback: feedback_provider,
        engine,
        warm_store,
    });

    let allowed_origins = config.cors_allowed_origins.clone();

    let app = Router::new()
        .route("/health", get(health_check))
        .route("/metrics", get(metrics_handler))
        .nest(
            "/api/admin",
            crate::api::admin::admin_routes(app_state.clone()),
        )
        .nest("/api/saas", crate::saas::routes(app_state.clone()))
        .route("/v1/usage", get(crate::api::stats_handler::get_key_usage))
        .route("/v1/models", get(crate::api::models::list_models))
        .route(
            "/v1/chat/completions",
            post(crate::api::proxy::chat_completions),
        )
        .route(
            "/v1/zene/sessions/:session_id/publish",
            post(crate::api::warm::publish),
        )
        .route(
            "/v1/zene/sessions/:session_id",
            delete(crate::api::warm::delete_session),
        )
        .route("/v1/zene/metrics", get(crate::api::warm::metrics))
        .route("/v1/messages", post(crate::api::proxy::anthropic_messages))
        .route("/v1/responses", post(crate::api::proxy::responses))
        .layer(
            CorsLayer::new()
                .allow_origin(AllowOrigin::predicate(move |origin, _| {
                    let origin_str = match origin.to_str() {
                        Ok(s) => s,
                        Err(_) => return false,
                    };
                    origin_str.starts_with("http://localhost:")
                        || origin_str.starts_with("http://127.0.0.1:")
                        || origin_str.ends_with(".pages.dev")
                        || origin_str.ends_with("smartgate.run")
                        || allowed_origins.iter().any(|o| o == origin_str)
                }))
                .allow_credentials(true)
                .allow_methods([
                    axum::http::Method::GET,
                    axum::http::Method::POST,
                    axum::http::Method::PATCH,
                    axum::http::Method::DELETE,
                    axum::http::Method::OPTIONS,
                ])
                .allow_headers([
                    axum::http::header::ACCEPT,
                    axum::http::header::AUTHORIZATION,
                    axum::http::header::CONTENT_TYPE,
                    axum::http::header::ORIGIN,
                    "X-Zene-Session-Id".parse().unwrap(),
                    "X-Zene-Context-Epoch".parse().unwrap(),
                    "X-Zene-Context-Delivery".parse().unwrap(),
                    "X-Zene-Prefix-Hash".parse().unwrap(),
                    "X-Zene-Tail-Start".parse().unwrap(),
                    "X-Zene-Request-Id".parse().unwrap(),
                ]),
        )
        .layer(middleware::from_fn(track_http_metrics))
        .layer(TraceLayer::new_for_http())
        .with_state(app_state);

    let app = if std::path::Path::new("web/dist").exists() {
        app.fallback_service(
            ServeDir::new("web/dist").not_found_service(ServeFile::new("web/dist/index.html")),
        )
    } else {
        app.fallback(get(|| async {
            "SmartGate API is running. Admin UI: http://localhost:18764"
        }))
    };

    let listener = tokio::net::TcpListener::bind(config.addr).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    tracing::info!("Shutdown signal received, stopping server");
}
