pub mod openrouter;

use crate::models::{EndpointMetric, ModelPool as DbModelPool, PoolEndpointMember};
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
    health_status: String,
    cooldown_until: Option<chrono::DateTime<chrono::Utc>>,
}

/// Push DB pool config into UniGateway and refresh in-memory routing caches.
pub async fn sync_all_pools(
    engine: &UniGatewayEngine,
    db: &PgPool,
    pools: &DashMap<String, DbModelPool>,
    pool_members: &DashMap<String, Vec<PoolEndpointMember>>,
    profiles: &DashMap<String, EndpointProfile>,
    metrics: &DashMap<String, EndpointMetric>,
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
                    e.capability_score, e.supports_tools, e.context_length,
                    e.health_status, e.cooldown_until
             FROM endpoints e
             JOIN model_pool_endpoints mpe ON e.id = mpe.endpoint_id
             JOIN provider_accounts pa ON e.account_id = pa.id
             WHERE mpe.pool_id = $1 AND e.enabled = TRUE AND pa.status = 'active'
             ORDER BY mpe.priority DESC, mpe.weight DESC, e.id ASC",
        )
        .bind(&pool.id)
        .fetch_all(db)
        .await?;

        // Seed health from the database so a restart does not lose a degraded state,
        // and so the first successful request can clear it again.
        for row in &rows {
            if metrics.contains_key(&row.id) {
                continue;
            }
            let mut metric = EndpointMetric::new(row.id.clone());
            metric.health_status = row.health_status.clone();
            metric.cooldown_until = row.cooldown_until.filter(|until| *until > chrono::Utc::now());
            metrics.insert(row.id.clone(), metric);
        }

        let configured_capabilities: Vec<(String, f64)> = rows
            .iter()
            .map(|r| {
                (
                    r.upstream_model_id.clone(),
                    crate::pricing::effective_capability_score(
                        &r.upstream_model_id,
                        r.capability_score,
                    ),
                )
            })
            .collect();
        let capabilities = crate::pricing::resolve_pool_capabilities(&configured_capabilities);

        let members: Vec<PoolEndpointMember> = rows
            .iter()
            .zip(capabilities.iter())
            .map(|(r, &capability)| {
                let configured = configured_capabilities
                    .iter()
                    .position(|(model, _)| model == &r.upstream_model_id)
                    .map(|index| configured_capabilities[index].1)
                    .unwrap_or(capability);
                if (capability - configured).abs() > 1e-6 {
                    tracing::warn!(
                        target: "smartgate.sync",
                        pool_id = %pool.id,
                        endpoint_id = %r.id,
                        model = %r.upstream_model_id,
                        configured,
                        applied = capability,
                        "pool capability scores had no usable spread; using model family defaults so hard requests can reach the strongest endpoint"
                    );
                }
                profiles.insert(
                    r.id.clone(),
                    EndpointProfile {
                        price: UnitPrice {
                            input_per_1m: r.input_price_per_1m,
                            output_per_1m: r.output_price_per_1m,
                            cache_read_per_1m: None,
                        },
                        capability_score: capability,
                        family_capability_score: crate::pricing::default_capability_score(
                            &r.upstream_model_id,
                            None,
                        ),
                        supports_tools: r.supports_tools.map(|v| v != 0).or(Some(true)),
                        context_length: r.context_length,
                        ..Default::default()
                    },
                );
                PoolEndpointMember {
                    endpoint_id: r.id.clone(),
                    priority: r.pool_priority,
                    weight: r.pool_weight,
                }
            })
            .collect();

        let vm_records: Vec<(String, String)> = sqlx::query_as(
            "SELECT id, name FROM virtual_models WHERE pool_id = $1",
        )
        .bind(&pool.id)
        .fetch_all(db)
        .await
        .unwrap_or_default();

        let unigateway_endpoints: Vec<Endpoint> = rows
            .iter()
            .map(|r| {
                let (provider_kind, driver_id, family) =
                    map_provider(&r.protocol, &r.provider_type);
                let mut model_mapping = HashMap::new();
                model_mapping.insert("*".to_string(), r.upstream_model_id.clone());
                model_mapping.insert(pool.name.clone(), r.upstream_model_id.clone());
                model_mapping.insert(r.upstream_model_id.clone(), r.upstream_model_id.clone());
                for (_vm_id, vm_name) in &vm_records {
                    model_mapping.insert(vm_name.clone(), r.upstream_model_id.clone());
                }
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
                        model_mapping,
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

        pools.insert(pool.id.clone(), pool.clone());
        pools.insert(pool.name.clone(), pool.clone());
        pool_members.insert(pool.id.clone(), members.clone());
        pool_members.insert(pool.name.clone(), members.clone());
        for (vm_id, vm_name) in &vm_records {
            pools.insert(vm_id.clone(), pool.clone());
            pools.insert(vm_name.clone(), pool.clone());
            pool_members.insert(vm_id.clone(), members.clone());
            pool_members.insert(vm_name.clone(), members.clone());
        }

        let mut pool_keys = vec![pool.id.clone(), pool.name.clone()];
        for (vm_id, vm_name) in &vm_records {
            pool_keys.push(vm_id.clone());
            pool_keys.push(vm_name.clone());
        }
        for pkey in pool_keys {
            let mut pp = provider_pool.clone();
            pp.pool_id = pkey;
            let _ = engine.upsert_pool(pp).await;
        }
    }

    Ok(())
}

pub async fn sync_all_pools_from_state(
    engine: &Arc<UniGatewayEngine>,
    db: &PgPool,
    pools: &DashMap<String, DbModelPool>,
    pool_members: &DashMap<String, Vec<PoolEndpointMember>>,
    profiles: &DashMap<String, EndpointProfile>,
    metrics: &DashMap<String, EndpointMetric>,
) -> anyhow::Result<()> {
    sync_all_pools(engine.as_ref(), db, pools, pool_members, profiles, metrics).await
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

/// Load one enabled endpoint in the same UniGateway representation used by pool sync.
///
/// This is a control-plane lookup only. Request execution, protocol rendering, credentials,
/// retries, timeout handling, and provider health reporting remain inside UniGateway.
pub async fn load_endpoint_for_dispatch(
    db: &PgPool,
    endpoint_id: &str,
) -> anyhow::Result<Option<Endpoint>> {
    let row = sqlx::query_as::<_, SyncEndpointRow>(
        "SELECT e.id, e.account_id, e.upstream_model_id, e.enabled,
                0 AS pool_priority, 0 AS pool_weight,
                pa.provider_type, pa.protocol, pa.base_url, pa.api_key, pa.name AS account_name,
                e.input_price_per_1m, e.output_price_per_1m,
                e.capability_score, e.supports_tools, e.context_length,
                e.health_status, e.cooldown_until
         FROM endpoints e
         JOIN provider_accounts pa ON pa.id = e.account_id
         WHERE e.id = $1 AND e.enabled = TRUE AND pa.status = 'active'",
    )
    .bind(endpoint_id)
    .fetch_optional(db)
    .await?;

    let Some(row) = row else {
        return Ok(None);
    };

    let (provider_kind, driver_id, family) = map_provider(&row.protocol, &row.provider_type);
    let mut model_mapping = HashMap::new();
    model_mapping.insert("*".to_string(), row.upstream_model_id.clone());
    model_mapping.insert(row.upstream_model_id.clone(), row.upstream_model_id.clone());

    Ok(Some(Endpoint {
        endpoint_id: row.id,
        provider_name: Some(row.account_name.clone()),
        source_endpoint_id: Some(row.upstream_model_id.clone()),
        provider_family: family,
        provider_kind,
        driver_id: driver_id.to_string(),
        base_url: normalize_base_url(&row.base_url),
        api_key: SecretString::new(row.api_key),
        model_policy: ModelPolicy {
            default_model: Some(row.upstream_model_id),
            model_mapping,
        },
        enabled: row.enabled,
        max_concurrency: None,
        forward_metadata_as_headers: None,
        capabilities: EndpointCapabilities::default(),
        metadata: HashMap::from([
            ("account_id".to_string(), row.account_id),
            ("account_name".to_string(), row.account_name),
            ("provider_type".to_string(), row.provider_type),
            ("protocol".to_string(), row.protocol),
        ]),
    }))
}

fn normalize_base_url(url: &str) -> String {
    let trimmed = url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return String::new();
    }
    format!("{}/", trimmed)
}
