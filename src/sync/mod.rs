use crate::models::{ModelPool as DbModelPool, PoolEndpointMember};
use crate::pricing::{EndpointProfile, UnitPrice};
use dashmap::DashMap;
use sqlx::FromRow;
use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::Arc;
use unigateway_sdk::core::{
    Endpoint, EndpointCapabilities, LoadBalancingStrategy, ModelPolicy, ProviderKind, ProviderPool,
    RetryPolicy, SecretString, UniGatewayEngine,
};

#[derive(Debug, FromRow)]
struct SyncEndpointRow {
    id: String,
    account_id: String,
    upstream_model_id: String,
    enabled: bool,
    pool_priority: i32,
    pool_weight: i32,
    provider_type: String,
    protocol: String,
    base_url: String,
    api_key: String,
    account_name: String,
    input_price_per_1m: f64,
    output_price_per_1m: f64,
    capability_score: f64,
    supports_tools: Option<i32>,
    context_length: Option<i32>,
}

/// Push DB pool config into UniGateway and refresh in-memory routing caches.
pub async fn sync_all_pools(
    engine: &UniGatewayEngine,
    db: &PgPool,
    pools: &DashMap<String, DbModelPool>,
    pool_members: &DashMap<String, Vec<PoolEndpointMember>>,
    profiles: &DashMap<String, EndpointProfile>,
) -> anyhow::Result<()> {
    let db_pools =
        sqlx::query_as::<_, DbModelPool>("SELECT * FROM model_pools WHERE enabled = TRUE")
            .fetch_all(db)
            .await?;

    pools.clear();
    pool_members.clear();
    profiles.clear();

    for pool in db_pools {
        let rows = sqlx::query_as::<_, SyncEndpointRow>(
            "SELECT e.id, e.account_id, e.upstream_model_id, e.enabled,
                    mpe.priority AS pool_priority, mpe.weight AS pool_weight,
                    pa.provider_type, pa.protocol, pa.base_url, pa.api_key, pa.name AS account_name,
                    e.input_price_per_1m, e.output_price_per_1m,
                    e.capability_score, e.supports_tools, e.context_length
             FROM endpoints e
             JOIN model_pool_endpoints mpe ON e.id = mpe.endpoint_id
             JOIN provider_accounts pa ON e.account_id = pa.id
             WHERE mpe.pool_id = $1 AND e.enabled = TRUE AND pa.status = 'active'
             ORDER BY mpe.priority DESC, mpe.weight DESC, e.id ASC",
        )
        .bind(&pool.id)
        .fetch_all(db)
        .await?;

        let members: Vec<PoolEndpointMember> = rows
            .iter()
            .map(|r| {
                let default_cap = crate::pricing::default_capability_score(&r.upstream_model_id, None);
                let capability = if r.capability_score <= 0.0
                    || (r.capability_score - 0.50).abs() < 1e-5
                    || (r.capability_score - 0.70).abs() < 1e-5
                {
                    default_cap
                } else {
                    r.capability_score.clamp(0.0, 1.0)
                };
                profiles.insert(
                    r.id.clone(),
                    EndpointProfile {
                        price: UnitPrice {
                            input_per_1m: r.input_price_per_1m,
                            output_per_1m: r.output_price_per_1m,
                            cache_read_per_1m: None,
                        },
                        capability_score: capability,
                        supports_tools: r.supports_tools.map(|v| v != 0).or(Some(true)),
                        context_length: r.context_length,
                    },
                );
                PoolEndpointMember {
                    endpoint_id: r.id.clone(),
                    priority: r.pool_priority,
                    weight: r.pool_weight,
                }
            })
            .collect();

        let unigateway_endpoints: Vec<Endpoint> = rows
            .iter()
            .map(|r| {
                let (provider_kind, driver_id, family) =
                    map_provider(&r.protocol, &r.provider_type);
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
                    forward_metadata_as_headers: None,
                    capabilities: EndpointCapabilities::default(),
                    metadata: HashMap::from([
                        ("account_id".to_string(), r.account_id.clone()),
                        ("account_name".to_string(), r.account_name.clone()),
                        ("provider_type".to_string(), r.provider_type.clone()),
                        ("protocol".to_string(), r.protocol.clone()),
                    ]),
                }
            })
            .collect();

        let load_balancing = map_strategy(&pool.strategy, pool.session_affinity_enabled != 0);

        let provider_pool = ProviderPool {
            pool_id: pool.id.clone(),
            endpoints: unigateway_endpoints,
            load_balancing,
            retry_policy: RetryPolicy::default(),
            forward_metadata_as_headers: None,
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
    db: &PgPool,
    pools: &DashMap<String, DbModelPool>,
    pool_members: &DashMap<String, Vec<PoolEndpointMember>>,
    profiles: &DashMap<String, EndpointProfile>,
) -> anyhow::Result<()> {
    sync_all_pools(engine.as_ref(), db, pools, pool_members, profiles).await
}

fn map_strategy(strategy: &str, session_affinity_enabled: bool) -> LoadBalancingStrategy {
    use crate::routing::{canonicalize_strategy, uses_score_order};
    let s = canonicalize_strategy(strategy);
    if session_affinity_enabled || uses_score_order(s) {
        return LoadBalancingStrategy::ScoreOrdered;
    }
    match s {
        "fallback" => LoadBalancingStrategy::Fallback,
        "random" => LoadBalancingStrategy::Random,
        _ => LoadBalancingStrategy::RoundRobin,
    }
}

fn map_provider(
    protocol: &str,
    _provider_type: &str,
) -> (ProviderKind, &'static str, Option<String>) {
    match protocol.to_ascii_lowercase().as_str() {
        "anthropic" => (
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
    let trimmed = normalized.trim_end_matches('/');
    if let Some(stripped) = trimmed.strip_suffix("/v1") {
        normalized = stripped.to_string();
    } else {
        normalized = trimmed.to_string();
    }
    if !normalized.ends_with('/') {
        normalized.push('/');
    }
    normalized
}
