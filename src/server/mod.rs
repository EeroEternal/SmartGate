use axum::{Router, routing::{get, post}};
use crate::config::{Config, AppState};
use crate::db::init_db;
use crate::quota::QuotaLimiter;
use crate::routing::ParaGatewayFeedbackProvider;
use crate::usage::ParaGatewayHooks;
use dashmap::DashMap;
use std::sync::Arc;
use tower_http::trace::TraceLayer;
use unigateway_sdk::core::UniGatewayEngine;

pub async fn run(config: Config) -> anyhow::Result<()> {
    let db = init_db(&config.database_url).await?;
    
    let metrics = Arc::new(DashMap::new());
    let pools = Arc::new(DashMap::new());
    let pool_members = Arc::new(DashMap::new());
    let quotas = Arc::new(QuotaLimiter::new());
    
    let hooks = Arc::new(ParaGatewayHooks {
        db: db.clone(),
        metrics: metrics.clone(),
        quotas: quotas.clone(),
    });
    
    let feedback_provider = Arc::new(ParaGatewayFeedbackProvider {
        metrics: metrics.clone(),
        pools: pools.clone(),
        pool_members: pool_members.clone(),
    });
    
    let engine = Arc::new(
        UniGatewayEngine::builder()
            .with_builtin_http_drivers()
            .with_hooks(hooks)
            .with_routing_feedback_provider(feedback_provider)
            .build()
            .map_err(|e| anyhow::anyhow!("Failed to build UniGateway engine: {}", e))?
    );
    
    crate::sync::sync_all_pools(&engine, &db, &pools, &pool_members).await?;
    
    let app_state = Arc::new(AppState {
        config: config.clone(),
        db,
        metrics,
        pools,
        pool_members,
        quotas,
        engine,
    });
    
    let app = Router::new()
        .route("/", get(|| async { "ParaGateway API is running. Please use the Admin UI at http://localhost:18764" }))
        .route("/health", get(|| async { "OK" }))
        .nest("/api/admin", crate::api::admin::admin_routes(app_state.clone()))
        .route("/v1/chat/completions", post(crate::api::proxy::chat_completions))
        .layer(TraceLayer::new_for_http())
        .with_state(app_state);

    let listener = tokio::net::TcpListener::bind(config.addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
