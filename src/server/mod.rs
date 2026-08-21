use crate::config::{AppState, Config};
use crate::db::init_db;
use crate::quota::QuotaLimiter;
use crate::routing::SmartGateFeedbackProvider;
use crate::usage::SmartGateHooks;
use axum::{
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

async fn health_check() -> &'static str {
    "OK"
}

pub async fn run(config: Config) -> anyhow::Result<()> {
    let db = init_db(&config.database_url).await?;

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
                match cleanup_store.purge_expired() {
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
    axum::serve(listener, app).await?;

    Ok(())
}
