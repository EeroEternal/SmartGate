pub mod openrouter;

use crate::config::AppState;
use crate::models::{EndpointMetric, ModelPool as DbModelPool, PoolEndpointMember};
use crate::pricing::{EndpointProfile, UnitPrice};
use dashmap::DashMap;
use serde::Serialize;
use sqlx::{FromRow, SqlitePool};
use std::collections::HashMap;

#[derive(Debug, Clone, FromRow)]
pub struct SyncEndpointRow {
    pub id: String,
    pub account_id: String,
    pub upstream_model_id: String,
    pub enabled: bool,
    pub pool_priority: i32,
    pub pool_weight: i32,
    pub provider_type: String,
    pub protocol: String,
    pub base_url: String,
    pub api_key: String,
    pub account_name: String,
    /// `None` when the endpoint has no configured price (unpriced, never "free").
    pub input_price_per_1m: Option<f64>,
    pub output_price_per_1m: Option<f64>,
    pub capability_score: f64,
    pub supports_tools: Option<i32>,
    pub context_length: Option<i32>,
    pub health_status: String,
    pub cooldown_until: Option<chrono::DateTime<chrono::Utc>>,
}

/// Declarative catalog payload pushed to `xlite` via `POST /api/catalog/import`.
#[derive(Debug, Clone, Serialize)]
pub struct XliteCatalog {
    pub providers: Vec<XliteProvider>,
    pub models: Vec<XliteModel>,
    pub api_keys: Vec<XliteApiKey>,
}

#[derive(Debug, Clone, Serialize)]
pub struct XliteProvider {
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct XliteModel {
    pub name: String,
    pub enabled: bool,
    pub channels: Vec<XliteChannel>,
}

#[derive(Debug, Clone, Serialize)]
pub struct XliteChannel {
    pub provider: String,
    pub upstream_model: String,
    /// In `xlite`, priority is ascending (`0` = primary tier, `1, 2, ...` = backup failover tiers).
    pub priority: i32,
    pub weight: i32,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct XliteApiKey {
    pub name: String,
    pub key: String,
    pub models: Vec<String>,
    pub enabled: bool,
}

/// Refresh in-memory routing caches from SQLite and push the declarative catalog to `xlite` if configured.
pub async fn sync_all_pools(
    db: &SqlitePool,
    pools: &DashMap<String, DbModelPool>,
    pool_members: &DashMap<String, Vec<PoolEndpointMember>>,
    profiles: &DashMap<String, EndpointProfile>,
    metrics: &DashMap<String, EndpointMetric>,
    endpoints: &DashMap<String, SyncEndpointRow>,
) -> anyhow::Result<()> {
    let db_pools =
        sqlx::query_as::<_, DbModelPool>("SELECT * FROM model_pools WHERE enabled = TRUE")
            .fetch_all(db)
            .await?;

    pools.clear();
    pool_members.clear();
    profiles.clear();
    endpoints.clear();

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

        for row in &rows {
            endpoints.insert(row.id.clone(), row.clone());
            if metrics.contains_key(&row.id) {
                continue;
            }
            let mut metric = EndpointMetric::new(row.id.clone());
            metric.health_status = row.health_status.clone();
            metric.cooldown_until = row
                .cooldown_until
                .filter(|until| *until > chrono::Utc::now());
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

        let vm_records: Vec<(String, String)> =
            sqlx::query_as("SELECT id, name FROM virtual_models WHERE pool_id = $1")
                .bind(&pool.id)
                .fetch_all(db)
                .await
                .unwrap_or_default();

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
    }

    Ok(())
}

/// Sync all pools and push declarative catalog to `xlite` if `config.xlite_url` is set.
pub async fn sync_state_and_xlite(state: &AppState) -> anyhow::Result<()> {
    sync_all_pools(
        &state.db,
        &state.pools,
        &state.pool_members,
        &state.profiles,
        &state.metrics,
        &state.endpoints,
    )
    .await?;

    if let Some(xlite_url) = state.config.xlite_url.as_deref() {
        let catalog = build_xlite_catalog(state).await?;
        if let Err(err) = push_xlite_catalog(
            &state.http_client,
            xlite_url,
            &state.config.xlite_admin_password,
            &catalog,
        )
        .await
        {
            tracing::warn!(
                target: "smartgate.xlite",
                error = %err,
                xlite_url,
                "failed to push catalog to xlite container (will retry on next sync or use direct fallback)"
            );
        }
    }

    Ok(())
}

/// Build the declarative `XliteCatalog` from SmartGate's SQLite state, including:
/// - All active `provider_accounts`
/// - Every `virtual_model` and `model_pool`
/// - Tiered routing targets `<pool_id>:pro` (capability-first) and `<pool_id>:flash` (cost-first)
/// - Endpoint-specific targets `ep:<endpoint_id>` (with pool backups for pre-first-byte failover)
pub async fn build_xlite_catalog(state: &AppState) -> anyhow::Result<XliteCatalog> {
    let accounts: Vec<(String, String, String, String)> = sqlx::query_as(
        "SELECT id, name, base_url, api_key FROM provider_accounts WHERE status = 'active'",
    )
    .fetch_all(&state.db)
    .await?;

    let mut providers = Vec::with_capacity(accounts.len());
    let mut provider_name_by_id = HashMap::new();
    for (id, name, base_url, api_key) in accounts {
        let provider_key = format!("{} ({})", name, id);
        provider_name_by_id.insert(id, provider_key.clone());
        providers.push(XliteProvider {
            name: provider_key,
            base_url: normalize_base_url(&base_url)
                .trim_end_matches('/')
                .to_string(),
            api_key,
            enabled: true,
        });
    }

    let db_pools =
        sqlx::query_as::<_, DbModelPool>("SELECT * FROM model_pools WHERE enabled = TRUE")
            .fetch_all(&state.db)
            .await?;

    let mut models = Vec::new();
    let mut seen_model_names = std::collections::HashSet::new();

    for pool in db_pools {
        let Some(members) = state.pool_members.get(&pool.id) else {
            continue;
        };
        if members.is_empty() {
            continue;
        }

        // Default priority order (SmartGate priority DESC -> xlite priority ASC 0, 1, 2...)
        let default_channels: Vec<XliteChannel> = members
            .iter()
            .enumerate()
            .filter_map(|(idx, m)| {
                let ep = state.endpoints.get(&m.endpoint_id)?;
                let provider = provider_name_by_id.get(&ep.account_id)?.clone();
                Some(XliteChannel {
                    provider,
                    upstream_model: ep.upstream_model_id.clone(),
                    priority: idx as i32,
                    weight: m.weight.max(1),
                    enabled: ep.enabled,
                })
            })
            .collect();

        if default_channels.is_empty() {
            continue;
        }

        // Pro tier ordering: capability_score DESC
        let mut pro_members = members.clone();
        pro_members.sort_by(|a, b| {
            let cap_a = state
                .profiles
                .get(&a.endpoint_id)
                .map(|p| p.capability_score)
                .unwrap_or(0.5);
            let cap_b = state
                .profiles
                .get(&b.endpoint_id)
                .map(|p| p.capability_score)
                .unwrap_or(0.5);
            cap_b
                .total_cmp(&cap_a)
                .then_with(|| b.priority.cmp(&a.priority))
        });
        let pro_channels: Vec<XliteChannel> = pro_members
            .iter()
            .enumerate()
            .filter_map(|(idx, m)| {
                let ep = state.endpoints.get(&m.endpoint_id)?;
                let provider = provider_name_by_id.get(&ep.account_id)?.clone();
                Some(XliteChannel {
                    provider,
                    upstream_model: ep.upstream_model_id.clone(),
                    priority: idx as i32,
                    weight: m.weight.max(1),
                    enabled: ep.enabled,
                })
            })
            .collect();

        // Flash tier ordering: cost ASC, then capability DESC
        let mut flash_members = members.clone();
        flash_members.sort_by(|a, b| {
            let cost_a = state
                .profiles
                .get(&a.endpoint_id)
                .map(|p| p.price.estimate_cost(1000, 500))
                .unwrap_or(0.0);
            let cost_b = state
                .profiles
                .get(&b.endpoint_id)
                .map(|p| p.price.estimate_cost(1000, 500))
                .unwrap_or(0.0);
            cost_a.total_cmp(&cost_b).then_with(|| {
                let cap_a = state
                    .profiles
                    .get(&a.endpoint_id)
                    .map(|p| p.capability_score)
                    .unwrap_or(0.5);
                let cap_b = state
                    .profiles
                    .get(&b.endpoint_id)
                    .map(|p| p.capability_score)
                    .unwrap_or(0.5);
                cap_b.total_cmp(&cap_a)
            })
        });
        let flash_channels: Vec<XliteChannel> = flash_members
            .iter()
            .enumerate()
            .filter_map(|(idx, m)| {
                let ep = state.endpoints.get(&m.endpoint_id)?;
                let provider = provider_name_by_id.get(&ep.account_id)?.clone();
                Some(XliteChannel {
                    provider,
                    upstream_model: ep.upstream_model_id.clone(),
                    priority: idx as i32,
                    weight: m.weight.max(1),
                    enabled: ep.enabled,
                })
            })
            .collect();

        let pro_name = format!("{}:pro", pool.id);
        if seen_model_names.insert(pro_name.clone()) {
            models.push(XliteModel {
                name: pro_name,
                enabled: true,
                channels: pro_channels,
            });
        }

        let flash_name = format!("{}:flash", pool.id);
        if seen_model_names.insert(flash_name.clone()) {
            models.push(XliteModel {
                name: flash_name,
                enabled: true,
                channels: flash_channels,
            });
        }

        for name in [&pool.id, &pool.name] {
            if seen_model_names.insert(name.clone()) {
                models.push(XliteModel {
                    name: name.clone(),
                    enabled: true,
                    channels: default_channels.clone(),
                });
            }
        }

        let vm_names: Vec<(String,)> =
            sqlx::query_as("SELECT name FROM virtual_models WHERE pool_id = $1 AND enabled = TRUE")
                .bind(&pool.id)
                .fetch_all(&state.db)
                .await
                .unwrap_or_default();

        for (vm_name,) in vm_names {
            if seen_model_names.insert(vm_name.clone()) {
                models.push(XliteModel {
                    name: vm_name,
                    enabled: true,
                    channels: default_channels.clone(),
                });
            }
        }

        // Also register endpoint-specific models `ep:<endpoint_id>` with primary priority=0
        // and the remaining pool endpoints as automatic failover backups!
        for member in members.iter() {
            let ep_model_name = format!("ep:{}", member.endpoint_id);
            if !seen_model_names.insert(ep_model_name.clone()) {
                continue;
            }
            let Some(primary_ep) = state.endpoints.get(&member.endpoint_id) else {
                continue;
            };
            let Some(primary_provider) = provider_name_by_id.get(&primary_ep.account_id) else {
                continue;
            };
            let mut ep_channels = vec![XliteChannel {
                provider: primary_provider.clone(),
                upstream_model: primary_ep.upstream_model_id.clone(),
                priority: 0,
                weight: member.weight.max(1),
                enabled: primary_ep.enabled,
            }];
            for (idx, backup) in members
                .iter()
                .filter(|m| m.endpoint_id != member.endpoint_id)
                .enumerate()
            {
                if let Some(b_ep) = state.endpoints.get(&backup.endpoint_id) {
                    if let Some(b_prov) = provider_name_by_id.get(&b_ep.account_id) {
                        ep_channels.push(XliteChannel {
                            provider: b_prov.clone(),
                            upstream_model: b_ep.upstream_model_id.clone(),
                            priority: (idx + 1) as i32,
                            weight: backup.weight.max(1),
                            enabled: b_ep.enabled,
                        });
                    }
                }
            }
            models.push(XliteModel {
                name: ep_model_name,
                enabled: true,
                channels: ep_channels,
            });
        }
    }

    let api_keys = vec![XliteApiKey {
        name: "smartgate-control-plane".to_string(),
        key: state.config.xlite_internal_key.clone(),
        models: Vec::new(),
        enabled: true,
    }];

    Ok(XliteCatalog {
        providers,
        models,
        api_keys,
    })
}

pub async fn push_xlite_catalog(
    client: &reqwest::Client,
    xlite_url: &str,
    admin_password: &str,
    catalog: &XliteCatalog,
) -> anyhow::Result<()> {
    let yaml_str = serde_json::to_string(catalog)?;
    let url = format!("{}/api/catalog/import", xlite_url.trim_end_matches('/'));
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", admin_password))
        .json(&serde_json::json!({
            "yaml": yaml_str,
            "replace": true,
        }))
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("xlite catalog import failed ({}): {}", status, body);
    }

    tracing::info!(
        target: "smartgate.xlite",
        providers = catalog.providers.len(),
        models = catalog.models.len(),
        "pushed declarative routing catalog to xlite"
    );
    Ok(())
}

pub fn normalize_base_url(url: &str) -> String {
    let trimmed = url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return String::new();
    }
    format!("{}/", trimmed)
}
