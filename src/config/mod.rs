use crate::models::{EndpointMetric, ModelPool, PoolEndpointMember};
use crate::pricing::EndpointProfile;
use crate::quota::QuotaLimiter;
use crate::warm::{WarmConfig, WarmStore};
use dashmap::DashMap;
use serde::Deserialize;
use sqlx::PgPool;
use std::net::SocketAddr;
use std::sync::Arc;
use unigateway_sdk::core::UniGatewayEngine;

#[derive(Debug, Deserialize, Clone)]
pub struct Config {
    pub addr: SocketAddr,
    pub database_url: String,
    pub admin_token: String,
    pub cors_allowed_origins: Vec<String>,
    pub resend_api_key: Option<String>,
    pub resend_from_email: Option<String>,
    pub warm: WarmConfig,
}

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub db: PgPool,
    pub metrics: Arc<DashMap<String, EndpointMetric>>,
    pub pools: Arc<DashMap<String, ModelPool>>,
    pub pool_members: Arc<DashMap<String, Vec<PoolEndpointMember>>>,
    pub profiles: Arc<DashMap<String, EndpointProfile>>,
    pub quotas: Arc<QuotaLimiter>,
    pub hints: Arc<DashMap<String, crate::policy::RouteHint>>,
    pub feedback: Arc<crate::routing::SmartGateFeedbackProvider>,
    pub engine: Arc<UniGatewayEngine>,
    pub warm_store: Arc<WarmStore>,
}

impl Config {
    pub fn load() -> anyhow::Result<Self> {
        dotenvy::dotenv().ok();

        let addr = if let Ok(addr) = std::env::var("ADDR") {
            addr.parse()?
        } else if let Ok(port) = std::env::var("PORT") {
            format!("0.0.0.0:{port}").parse()?
        } else {
            "0.0.0.0:8080".parse()?
        };

        let database_url = std::env::var("DATABASE_URL").map_err(|_| {
            anyhow::anyhow!("DATABASE_URL must be set to a PostgreSQL connection URL")
        })?;

        let admin_token =
            std::env::var("ADMIN_TOKEN").map_err(|_| anyhow::anyhow!("ADMIN_TOKEN must be set"))?;
        let default_origins = "http://127.0.0.1:18764,http://localhost:18764,https://smartgate.run,https://app.smartgate.run,https://api.smartgate.run";
        let cors_allowed_origins = std::env::var("CORS_ALLOWED_ORIGIN")
            .unwrap_or_else(|_| default_origins.to_string())
            .split(',')
            .map(str::trim)
            .filter(|origin| !origin.is_empty())
            .map(ToOwned::to_owned)
            .collect();

        Ok(Self {
            addr,
            database_url,
            admin_token,
            cors_allowed_origins,
            resend_api_key: std::env::var("RESEND_API_KEY").ok(),
            resend_from_email: std::env::var("RESEND_FROM_EMAIL").ok(),
            warm: WarmConfig::from_env()?,
        })
    }
}
