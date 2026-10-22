use crate::models::{EndpointMetric, ModelPool, PoolEndpointMember};
use crate::pricing::EndpointProfile;
use crate::quota::QuotaLimiter;
use dashmap::DashMap;
use serde::Deserialize;
use sqlx::SqlitePool;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

#[derive(Debug, Deserialize, Clone)]
pub struct Config {
    pub addr: SocketAddr,
    pub database_url: String,
    pub admin_token: String,
    pub cors_allowed_origins: Vec<String>,
    /// Standalone `xlite` data-plane URL (e.g. `http://xlite.railway.internal:8080` or `http://127.0.0.1:8081`).
    pub xlite_url: Option<String>,
    /// Admin password used to push declarative catalogs to `xlite` (`POST /api/catalog/import`).
    pub xlite_admin_password: String,
    /// Internal API key configured into `xlite` for SmartGate -> xlite data-plane calls.
    pub xlite_internal_key: String,
}

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub db: SqlitePool,
    pub metrics: Arc<DashMap<String, EndpointMetric>>,
    pub pools: Arc<DashMap<String, ModelPool>>,
    pub pool_members: Arc<DashMap<String, Vec<PoolEndpointMember>>>,
    pub profiles: Arc<DashMap<String, EndpointProfile>>,
    pub endpoints: Arc<DashMap<String, crate::sync::SyncEndpointRow>>,
    pub quotas: Arc<QuotaLimiter>,
    pub hints: Arc<DashMap<String, crate::policy::RouteHint>>,
    pub feedback: Arc<crate::routing::SmartGateFeedbackProvider>,
    pub http_client: reqwest::Client,
}

impl AppState {
    pub fn build_http_client() -> reqwest::Client {
        reqwest::Client::builder()
            .pool_max_idle_per_host(64)
            .pool_idle_timeout(Duration::from_secs(90))
            .tcp_nodelay(true)
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(300))
            .build()
            .expect("failed to build reqwest HTTP client")
    }
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

        let database_url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "sqlite://smartgate.db?mode=rwc".to_string());

        let admin_token =
            std::env::var("ADMIN_TOKEN").unwrap_or_else(|_| "smartgate-admin-token".to_string());

        let default_origins = "http://127.0.0.1:18764,http://localhost:18764,https://smartgate.run,https://app.smartgate.run,https://api.smartgate.run";
        let cors_allowed_origins = std::env::var("CORS_ALLOWED_ORIGIN")
            .unwrap_or_else(|_| default_origins.to_string())
            .split(',')
            .map(str::trim)
            .filter(|origin| !origin.is_empty())
            .map(ToOwned::to_owned)
            .collect();

        let xlite_url = std::env::var("XLITE_UPSTREAM_URL")
            .or_else(|_| std::env::var("XLITE_URL"))
            .ok()
            .map(|s| s.trim().trim_end_matches('/').to_string())
            .filter(|s| !s.is_empty());

        let xlite_admin_password = std::env::var("XLITE_ADMIN_PASSWORD")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| admin_token.clone());

        let xlite_internal_key = std::env::var("XLITE_INTERNAL_API_KEY")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "sk-smartgate-xlite-internal".to_string());

        Ok(Self {
            addr,
            database_url,
            admin_token,
            cors_allowed_origins,
            xlite_url,
            xlite_admin_password,
            xlite_internal_key,
        })
    }
}
