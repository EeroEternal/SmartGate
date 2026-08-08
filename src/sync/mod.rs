use crate::models::{ModelPool as DbModelPool, PoolEndpointMember};
use dashmap::DashMap;
use sqlx::FromRow;
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::sync::Arc;
use unigateway_sdk::core::{
    Endpoint, LoadBalancingStrategy, ModelPolicy, ProviderKind, ProviderPool, RetryPolicy,
    SecretString, UniGatewayEngine,
};

#[derive(Debug, FromRow)]
struct SyncEndpointRow {
    id: String,
    upstream_model_id: String,
    enabled: bool,
    pool_priority: i32,
    pool_weight: i32,
    provider_type: String,
    base_url: String,
    api_key: String,
    account_name: String,
}

/// Push DB pool config into UniGateway and refresh in-memory routing caches.
pub async fn sync_all_pools(
    engine: &UniGatewayEngine,
    db: &SqlitePool,
    pools: &DashMap<String, DbModelPool>,
    pool_members: &DashMap<String, Vec<PoolEndpointMember>>,
) -> anyhow::Result<()> {
    let db_pools = sqlx::query_as::<_, DbModelPool>("SELECT * FROM model_pools WHERE enabled = 1")
        .fetch_all(db)
        .await?;

    pools.clear();
    pool_members.clear();

    for pool in db_pools {
        let rows = sqlx::query_as::<_, SyncEndpointRow>(
            "SELECT e.id, e.upstream_model_id, e.enabled,
                    mpe.priority AS pool_priority, mpe.weight AS pool_weight,
                    pa.provider_type, pa.base_url, pa.api_key, pa.name AS account_name
             FROM endpoints e
             JOIN model_pool_endpoints mpe ON e.id = mpe.endpoint_id
             JOIN provider_accounts pa ON e.account_id = pa.id
             WHERE mpe.pool_id = ? AND e.enabled = 1 AND pa.status = 'active'
             ORDER BY mpe.priority DESC, mpe.weight DESC, e.id ASC",
        )
        .bind(&pool.id)
        .fetch_all(db)
        .await?;

        let members: Vec<PoolEndpointMember> = rows
            .iter()
            .map(|r| PoolEndpointMember {
                endpoint_id: r.id.clone(),
                priority: r.pool_priority,
                weight: r.pool_weight,
            })
            .collect();

        let unigateway_endpoints: Vec<Endpoint> = rows
            .iter()
            .map(|r| {
                let (provider_kind, driver_id, family) = map_provider(&r.provider_type);
                Endpoint {
                    endpoint_id: r.id.clone(),
                    provider_name: Some(r.account_name.clone()),
                    source_endpoint_id: Some(r.upstream_model_id.clone()),
                    provider_family: family,
                    provider_kind,
                    driver_id: driver_id.to_string(),
                    base_url: normalize_base_url(&r.base_url),
                    api_key: SecretString::new(r.api_key.clone()),
                    model_policy: ModelPolicy {
                        default_model: Some(r.upstream_model_id.clone()),
                        model_mapping: HashMap::new(),
                    },
                    enabled: r.enabled,
                    max_concurrency: None,
                    metadata: HashMap::from([
                        ("account_name".to_string(), r.account_name.clone()),
                        ("provider_type".to_string(), r.provider_type.clone()),
                    ]),
                }
            })
            .collect();

        let load_balancing = map_strategy(&pool.strategy);

        let provider_pool = ProviderPool {
            pool_id: pool.id.clone(),
            endpoints: unigateway_endpoints,
            load_balancing,
            retry_policy: RetryPolicy::default(),
            metadata: HashMap::from([("strategy".to_string(), pool.strategy.clone())]),
        };

        engine.upsert_pool(provider_pool).await?;
        pool_members.insert(pool.id.clone(), members);
        pools.insert(pool.id.clone(), pool);
    }

    Ok(())
}

pub async fn sync_all_pools_from_state(
    engine: &Arc<UniGatewayEngine>,
    db: &SqlitePool,
    pools: &DashMap<String, DbModelPool>,
    pool_members: &DashMap<String, Vec<PoolEndpointMember>>,
) -> anyhow::Result<()> {
    sync_all_pools(engine.as_ref(), db, pools, pool_members).await
}

fn map_strategy(strategy: &str) -> LoadBalancingStrategy {
    match strategy {
        // ScoreOrdered keeps feedback score order (priority / latency / least-conn).
        "priority" | "latency_based" | "least_connections" | "score_ordered" => {
            LoadBalancingStrategy::ScoreOrdered
        }
        "fallback" => LoadBalancingStrategy::Fallback,
        "random" => LoadBalancingStrategy::Random,
        _ => LoadBalancingStrategy::RoundRobin,
    }
}

fn map_provider(provider_type: &str) -> (ProviderKind, &'static str, Option<String>) {
    match provider_type.to_ascii_lowercase().as_str() {
        "anthropic" | "claude" => (
            ProviderKind::Anthropic,
            "anthropic",
            Some("anthropic".to_string()),
        ),
        other => (
            ProviderKind::OpenAiCompatible,
            "openai-compatible",
            Some(other.to_string()),
        ),
    }
}

fn normalize_base_url(url: &str) -> String {
    let mut normalized = url.trim().to_string();
    if normalized.is_empty() {
        return normalized;
    }
    if !normalized.ends_with('/') {
        normalized.push('/');
    }
    normalized
}
