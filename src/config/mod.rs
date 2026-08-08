use serde::Deserialize;
use std::net::SocketAddr;
use sqlx::SqlitePool;
use dashmap::DashMap;
use std::sync::Arc;
use crate::models::{EndpointMetric, ModelPool, PoolEndpointMember};
use crate::quota::QuotaLimiter;
use unigateway_sdk::core::UniGatewayEngine;

#[derive(Debug, Deserialize, Clone)]
pub struct Config {
    pub addr: SocketAddr,
    pub database_url: String,
    pub admin_token: String,
}

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub db: SqlitePool,
    pub metrics: Arc<DashMap<String, EndpointMetric>>,
    pub pools: Arc<DashMap<String, ModelPool>>,
    pub pool_members: Arc<DashMap<String, Vec<PoolEndpointMember>>>,
    pub quotas: Arc<QuotaLimiter>,
    pub engine: Arc<UniGatewayEngine>,
}

impl Config {
    pub fn load() -> anyhow::Result<Self> {
        dotenvy::dotenv().ok();
        
        let addr = std::env::var("ADDR")
            .unwrap_or_else(|_| "0.0.0.0:8080".to_string())
            .parse()?;
            
        let database_url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "sqlite:paragateway.db".to_string());
            
        let admin_token = std::env::var("ADMIN_TOKEN")
            .expect("ADMIN_TOKEN must be set");

        Ok(Self {
            addr,
            database_url,
            admin_token,
        })
    }
}
