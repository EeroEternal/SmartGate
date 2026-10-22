use crate::config::{AppState, Config};
use crate::db::init_db;
use crate::quota::QuotaLimiter;
use crate::routing::SmartGateFeedbackProvider;
use axum::{
    extract::State,
    http::{header::CONTENT_TYPE, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Router,
};
use dashmap::DashMap;
use std::sync::Arc;
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};

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
    let db_ok = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        sqlx::query("SELECT 1").execute(&state.db),
    )
    .await
    .map(|r| r.is_ok())
    .unwrap_or(false);

    if db_ok {
        (
            StatusCode::OK,
            Json(serde_json::json!({
                "status": "ok",
                "database": "sqlite",
                "xlite_configured": state.config.xlite_url.is_some()
            })),
        )
            .into_response()
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

    if let Ok(key) = std::env::var("OPENROUTER_API_KEY") {
        let trimmed = key.trim();
        if !trimmed.is_empty() {
            tracing::info!(
                "Syncing OPENROUTER_API_KEY from environment to free token provider account"
            );
            let _ = sqlx::query(
                "UPDATE provider_accounts SET api_key = $1, updated_at = CURRENT_TIMESTAMP WHERE id = 'pa_openrouter_free'",
            )
            .bind(trimmed)
            .execute(&db)
            .await;
            let _ = sqlx::query(
                "UPDATE free_token_pool_config SET openrouter_api_key = $1, updated_at = CURRENT_TIMESTAMP WHERE id = 'default'",
            )
            .bind(trimmed)
            .execute(&db)
            .await;
        }
    }

    if let Some(handle) = init_metrics() {
        METRICS_HANDLE.set(handle).ok();
    }

    let metrics = Arc::new(DashMap::new());
    let pools = Arc::new(DashMap::new());
    let pool_members = Arc::new(DashMap::new());
    let profiles = Arc::new(DashMap::new());
    let endpoints = Arc::new(DashMap::new());
    let quotas = Arc::new(QuotaLimiter::new());
    let hints = Arc::new(DashMap::new());

    let feedback_provider = Arc::new(SmartGateFeedbackProvider {
        metrics: metrics.clone(),
        pools: pools.clone(),
        pool_members: pool_members.clone(),
        profiles: profiles.clone(),
        hints: hints.clone(),
    });

    let app_state = Arc::new(AppState {
        config: config.clone(),
        db: db.clone(),
        metrics,
        pools,
        pool_members,
        profiles,
        endpoints,
        quotas,
        hints,
        feedback: feedback_provider,
        http_client: AppState::build_http_client(),
    });

    crate::sync::sync_state_and_xlite(&app_state).await?;

    // Spawn background sync worker for OpenRouter market catalog (every 6 hours)
    crate::sync::openrouter::spawn_openrouter_sync_worker(
        db.clone(),
        std::time::Duration::from_secs(6 * 3600),
    );

    // Keep the public free pool pointed at models the market still offers (needs the catalog above).
    let heal_state = app_state.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(10)).await;
        crate::free_token::heal_free_pool_from_market(&heal_state).await;
    });

    // Periodic xlite catalog heartbeat (every 60s) if xlite_url is configured
    if app_state.config.xlite_url.is_some() {
        let sync_state = app_state.clone();
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(std::time::Duration::from_secs(60));
            loop {
                ticker.tick().await;
                let _ = crate::sync::sync_state_and_xlite(&sync_state).await;
            }
        });
    }

    let allowed_origins = config.cors_allowed_origins.clone();

    let app = Router::new()
        .route("/health", get(health_check))
        .route("/api/health", get(health_check))
        .route("/metrics", get(metrics_handler))
        .route(
            "/api/gateway/usage",
            post(crate::usage::xlite_usage_webhook),
        )
        .nest(
            "/api/admin",
            crate::api::admin::admin_routes(app_state.clone()),
        )
        .route(
            "/api/free-token/claim",
            post(crate::free_token::claim_free_key),
        )
        .route(
            "/api/free-token/info",
            get(crate::free_token::get_free_pool_info),
        )
        .route(
            "/api/free-token/check",
            post(crate::free_token::check_free_key),
        )
        .route("/v1/usage", get(crate::api::stats_handler::get_key_usage))
        .route("/v1/models", get(crate::api::models::list_models))
        .route(
            "/v1/chat/completions",
            post(crate::api::proxy::chat_completions),
        )
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
                ]),
        )
        .layer(middleware::from_fn(track_http_metrics))
        .layer(TraceLayer::new_for_http())
        .with_state(app_state);

    let app = if std::path::Path::new("web/dist").exists() {
        // Assets are served from disk; every other path renders the SPA shell so client-side
        // routes such as `/admin/pools` survive a hard refresh.
        let index_html = std::fs::read("web/dist/index.html").unwrap_or_default();
        app.nest_service("/assets", ServeDir::new("web/dist/assets"))
            .route_service("/favicon.svg", ServeFile::new("web/dist/favicon.svg"))
            .fallback(get(move || {
                let body = index_html.clone();
                async move { ([(CONTENT_TYPE, "text/html; charset=utf-8")], body) }
            }))
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
