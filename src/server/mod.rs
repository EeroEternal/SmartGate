use crate::config::{AppState, Config};
use crate::db::init_db;
use crate::quota::QuotaLimiter;
use crate::routing::SmartGateFeedbackProvider;
use crate::usage::SmartGateHooks;
use axum::{
    routing::{get, post},
    Router,
};
use dashmap::DashMap;
use std::sync::Arc;
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
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
    });

    let engine = Arc::new(
        UniGatewayEngine::builder()
            .with_builtin_http_drivers()
            .with_hooks(hooks)
            .with_routing_feedback_provider(feedback_provider)
            .build()
            .map_err(|e| anyhow::anyhow!("Failed to build UniGateway engine: {}", e))?,
    );

    crate::sync::sync_all_pools(&engine, &db, &pools, &pool_members, &profiles).await?;

    let app_state = Arc::new(AppState {
        config: config.clone(),
        db,
        metrics,
        pools,
        pool_members,
        profiles,
        quotas,
        engine,
    });

    let app = Router::new()
        .route(
            "/",
            get(|| async { "SmartGate API is running. Admin UI: http://localhost:18764" }),
        )
        .route("/health", get(health_check))
        .nest(
            "/api/admin",
            crate::api::admin::admin_routes(app_state.clone()),
        )
        .nest("/api/saas", crate::saas::routes(app_state.clone()))
        .route("/v1/usage", get(crate::api::stats_handler::get_key_usage))
        .route(
            "/v1/chat/completions",
            post(crate::api::proxy::chat_completions),
        )
        .route("/v1/responses", post(crate::api::proxy::responses))
        .layer(
            CorsLayer::new()
                .allow_origin(AllowOrigin::list(
                    config
                        .cors_allowed_origins
                        .iter()
                        .filter_map(|origin| origin.parse().ok())
                        .collect::<Vec<_>>(),
                ))
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
        .layer(TraceLayer::new_for_http())
        .with_state(app_state);

    let listener = tokio::net::TcpListener::bind(config.addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
