//! Zene Warm-layer prefix storage and delta assembly.
//!
//! This module deliberately stores only the latest canonical prefix snapshot. It
//! does not own Agent transcripts, compaction, or inference-engine KV blocks.

use axum::http::HeaderMap;
use redis::{Commands, Script};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::Hasher;
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use unigateway_sdk::host::HostMiddleware;
use unigateway_sdk::session::{
    fingerprints_match, DeltaAssemblyMiddleware, Fingerprint, FingerprintPolicy,
    MemorySessionStore, PublishResult, SessionError, SessionKey as GatewaySessionKey,
    SessionKeyResolver, SessionMiddlewareConfig, SessionPrefix, SessionSizeLimits, SessionStore,
    SessionStoreConfig, TailPositionPolicy, SESSION_GATEWAY_FIELD,
};

pub const HASH_ALGORITHM_VERSION: &str = "v1";

/// SmartGate-owned configuration for the generic UniGateway session store.
///
/// Limits are disabled by default for backwards compatibility. Values are
/// loaded from `SMARTGATE_WARM_*` environment variables by `from_env`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WarmConfig {
    pub idle_ttl_secs: Option<u64>,
    pub max_lifetime_secs: Option<u64>,
    pub max_messages: Option<usize>,
    pub max_prefix_bytes: Option<usize>,
    pub max_tail_bytes: Option<usize>,
    pub max_assembled_bytes: Option<usize>,
    pub cleanup_interval_secs: Option<u64>,
    pub redis_url: Option<String>,
    pub redis_key_prefix: String,
    pub require_virtual_model: bool,
}

impl Default for WarmConfig {
    fn default() -> Self {
        Self {
            idle_ttl_secs: None,
            max_lifetime_secs: None,
            max_messages: None,
            max_prefix_bytes: None,
            max_tail_bytes: None,
            max_assembled_bytes: None,
            cleanup_interval_secs: Some(60),
            redis_url: None,
            redis_key_prefix: "smartgate:warm:".to_string(),
            require_virtual_model: false,
        }
    }
}

impl WarmConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        let defaults = Self::default();
        Ok(Self {
            idle_ttl_secs: optional_env("SMARTGATE_WARM_IDLE_TTL_SECS")?,
            max_lifetime_secs: optional_env("SMARTGATE_WARM_MAX_LIFETIME_SECS")?,
            max_messages: optional_env("SMARTGATE_WARM_MAX_MESSAGES")?,
            max_prefix_bytes: optional_env("SMARTGATE_WARM_MAX_PREFIX_BYTES")?,
            max_tail_bytes: optional_env("SMARTGATE_WARM_MAX_TAIL_BYTES")?,
            max_assembled_bytes: optional_env("SMARTGATE_WARM_MAX_ASSEMBLED_BYTES")?,
            cleanup_interval_secs: match optional_env("SMARTGATE_WARM_CLEANUP_INTERVAL_SECS")? {
                Some(0) => None,
                Some(value) => Some(value),
                None => defaults.cleanup_interval_secs,
            },
            redis_url: std::env::var("SMARTGATE_WARM_REDIS_URL")
                .ok()
                .or_else(|| std::env::var("REDIS_URL").ok()),
            redis_key_prefix: normalize_key_prefix(
                &std::env::var("SMARTGATE_WARM_REDIS_KEY_PREFIX")
                    .unwrap_or_else(|_| defaults.redis_key_prefix.clone()),
            )?,
            require_virtual_model: optional_env_bool("SMARTGATE_WARM_REQUIRE_VIRTUAL_MODEL")?
                .unwrap_or(false),
        })
    }

    pub fn session_store_config(&self) -> SessionStoreConfig {
        SessionStoreConfig {
            size_limits: SessionSizeLimits {
                max_messages: self.max_messages,
                max_prefix_bytes: self.max_prefix_bytes,
                max_tail_bytes: self.max_tail_bytes,
                max_assembled_bytes: self.max_assembled_bytes,
            },
            lifetime: unigateway_sdk::session::SessionLifetime {
                idle_ttl: self.idle_ttl_secs.map(Duration::from_secs),
                max_lifetime: self.max_lifetime_secs.map(Duration::from_secs),
                touch_on_read: true,
            },
            ..Default::default()
        }
    }

    pub fn cleanup_interval(&self) -> Option<Duration> {
        self.cleanup_interval_secs.map(Duration::from_secs)
    }
}

fn optional_env_bool(name: &str) -> anyhow::Result<Option<bool>> {
    match std::env::var(name) {
        Ok(value) => match value.to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "on" => Ok(Some(true)),
            "0" | "false" | "no" | "off" => Ok(Some(false)),
            _ => Err(anyhow::anyhow!("{name} must be a boolean")),
        },
        Err(std::env::VarError::NotPresent) => Ok(None),
        Err(error) => Err(anyhow::anyhow!("failed to read {name}: {error}")),
    }
}

fn normalize_key_prefix(value: &str) -> anyhow::Result<String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 128 || value.chars().any(char::is_control) {
        return Err(anyhow::anyhow!(
            "SMARTGATE_WARM_REDIS_KEY_PREFIX must be 1-128 non-control characters"
        ));
    }
    Ok(if value.ends_with(':') {
        value.to_string()
    } else {
        format!("{value}:")
    })
}

fn optional_env<T>(name: &str) -> anyhow::Result<Option<T>>
where
    T: FromStr,
    T::Err: std::fmt::Display,
{
    match std::env::var(name) {
        Ok(value) => value
            .parse::<T>()
            .map(Some)
            .map_err(|error| anyhow::anyhow!("{name} must be a valid value: {error}")),
        Err(std::env::VarError::NotPresent) => Ok(None),
        Err(error) => Err(anyhow::anyhow!("failed to read {name}: {error}")),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SessionKey {
    pub project_id: String,
    pub api_key_id: String,
    pub session_id: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PrefixSnapshot {
    pub epoch: i64,
    pub prefix_hash: String,
    pub message_count: usize,
    pub messages: Vec<Value>,
    pub pinned_boundary: usize,
    pub virtual_model_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PublishInput {
    pub epoch: i64,
    pub message_count: usize,
    pub messages: Vec<Value>,
    pub pinned_boundary: usize,
    pub prefix_hash: Option<String>,
    pub virtual_model_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct WarmContext {
    pub session_id: Option<String>,
    pub epoch: Option<i64>,
    pub delivery: Delivery,
    pub prefix_hash: Option<String>,
    pub tail_start: Option<usize>,
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Delivery {
    Full,
    Delta,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WarmError {
    InvalidContext(String),
    SessionNotFound,
    SessionExpired,
    StoreUnavailable(String),
    PrefixTooLarge,
    TailTooLarge,
    AssembledTooLarge,
    EpochConflict,
    StaleEpoch,
    EpochMismatch,
    PrefixHashMismatch,
    TailStartMismatch { expected: usize, actual: usize },
    VirtualModelMismatch,
    VirtualModelUnauthorized,
    VirtualModelRequired,
    InvalidPublish(String),
}

impl WarmError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidContext(_) => "INVALID_CONTEXT",
            Self::SessionNotFound => "SESSION_NOT_FOUND",
            Self::SessionExpired => "SESSION_EXPIRED",
            Self::StoreUnavailable(_) => "PUBLISH_UNAVAILABLE",
            Self::PrefixTooLarge => "PREFIX_TOO_LARGE",
            Self::TailTooLarge => "TAIL_TOO_LARGE",
            Self::AssembledTooLarge => "ASSEMBLED_TOO_LARGE",
            Self::EpochConflict => "EPOCH_CONFLICT",
            Self::StaleEpoch => "STALE_EPOCH",
            Self::EpochMismatch => "EPOCH_MISMATCH",
            Self::PrefixHashMismatch => "PREFIX_HASH_MISMATCH",
            Self::TailStartMismatch { .. } => "TAIL_START_MISMATCH",
            Self::VirtualModelMismatch => "VIRTUAL_MODEL_MISMATCH",
            Self::VirtualModelUnauthorized => "MODEL_NOT_AUTHORIZED",
            Self::VirtualModelRequired => "VIRTUAL_MODEL_REQUIRED",
            Self::InvalidPublish(_) => "INVALID_CONTEXT",
        }
    }

    pub fn message(&self) -> String {
        match self {
            Self::InvalidContext(message) | Self::InvalidPublish(message) => message.clone(),
            Self::SessionNotFound => "Zene session was not found".to_string(),
            Self::SessionExpired => "Zene session has expired".to_string(),
            Self::StoreUnavailable(message) => message.clone(),
            Self::PrefixTooLarge => "The published prefix is too large".to_string(),
            Self::TailTooLarge => "The delta tail is too large".to_string(),
            Self::AssembledTooLarge => "The assembled request is too large".to_string(),
            Self::EpochConflict => "The epoch already contains a different prefix".to_string(),
            Self::StaleEpoch => "The publish epoch is older than the stored prefix".to_string(),
            Self::EpochMismatch => "The request epoch does not match the stored prefix".to_string(),
            Self::PrefixHashMismatch => {
                "The prefix hash does not match the stored prefix".to_string()
            }
            Self::TailStartMismatch { expected, actual } => {
                format!("tail_start must equal {expected}, got {actual}")
            }
            Self::VirtualModelMismatch => {
                "The session is bound to a different Virtual Model".to_string()
            }
            Self::VirtualModelUnauthorized => {
                "The requested Virtual Model is not authorized".to_string()
            }
            Self::VirtualModelRequired => "virtual_model is required for Warm publish".to_string(),
        }
    }
}

/// SmartGate's Zene adapter over UniGateway's generic session store.
///
/// SmartGate owns the authenticated namespace and Virtual Model binding. The
/// generic store owns snapshot consistency and lifecycle semantics.
pub struct WarmStore {
    store: Arc<dyn SessionStore>,
    size_limits: SessionSizeLimits,
    middleware_config: SessionMiddlewareConfig,
    virtual_models: Mutex<HashMap<SessionKey, Option<String>>>,
    binding_store: Option<Arc<RedisBindingStore>>,
    redis_key_prefix: String,
    publish_lock: Mutex<()>,
    metrics: Arc<WarmMetrics>,
}

#[derive(Default)]
pub struct WarmMetrics {
    pub publish_attempts: AtomicU64,
    pub publish_successes: AtomicU64,
    pub publish_failures: AtomicU64,
    pub delta_attempts: AtomicU64,
    pub delta_successes: AtomicU64,
    pub delta_failures: AtomicU64,
    pub full_deliveries: AtomicU64,
    pub virtual_model_mismatches: AtomicU64,
    pub store_unavailable: AtomicU64,
    pub cleanup_runs: AtomicU64,
    pub cleanup_failures: AtomicU64,
    pub sessions_removed: AtomicU64,
}

impl WarmMetrics {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn snapshot(&self) -> Value {
        json!({
            "publish_attempts": self.publish_attempts.load(Ordering::Relaxed),
            "publish_successes": self.publish_successes.load(Ordering::Relaxed),
            "publish_failures": self.publish_failures.load(Ordering::Relaxed),
            "delta_attempts": self.delta_attempts.load(Ordering::Relaxed),
            "delta_successes": self.delta_successes.load(Ordering::Relaxed),
            "delta_failures": self.delta_failures.load(Ordering::Relaxed),
            "full_deliveries": self.full_deliveries.load(Ordering::Relaxed),
            "virtual_model_mismatches": self.virtual_model_mismatches.load(Ordering::Relaxed),
            "store_unavailable": self.store_unavailable.load(Ordering::Relaxed),
            "cleanup_runs": self.cleanup_runs.load(Ordering::Relaxed),
            "cleanup_failures": self.cleanup_failures.load(Ordering::Relaxed),
            "sessions_removed": self.sessions_removed.load(Ordering::Relaxed),
        })
    }
}

struct RedisBindingStore {
    client: redis::Client,
    key_prefix: String,
    idle_ttl: Option<Duration>,
    max_lifetime: Option<Duration>,
    publish_script: Script,
    delete_script: Script,
}

impl RedisBindingStore {
    fn open(
        redis_url: &str,
        base_prefix: &str,
        lifetime: &unigateway_sdk::session::SessionLifetime,
    ) -> anyhow::Result<Self> {
        Ok(Self {
            client: redis::Client::open(redis_url)?,
            key_prefix: format!("{}binding:", base_prefix),
            idle_ttl: lifetime.idle_ttl,
            max_lifetime: lifetime.max_lifetime,
            publish_script: Script::new(
                r#"local prefix_key = KEYS[1]
local binding_key = KEYS[2]
local new_epoch = tonumber(ARGV[1])
local prefix_json = ARGV[2]
local now = tonumber(ARGV[3])
local idle_ttl = tonumber(ARGV[4])
local max_lifetime = tonumber(ARGV[5])
local virtual_model = ARGV[6]
local old_epoch = redis.call('HGET', prefix_key, 'epoch')
local old_created = tonumber(redis.call('HGET', prefix_key, 'created_at') or '0')
local old_accessed = tonumber(redis.call('HGET', prefix_key, 'last_accessed_at') or '0')
if old_epoch and ((max_lifetime > 0 and now - old_created >= max_lifetime) or (idle_ttl > 0 and now - old_accessed >= idle_ttl)) then
  redis.call('DEL', prefix_key, binding_key)
  old_epoch = false
end
local existing_model = redis.call('HGET', binding_key, 'virtual_model_id')
if existing_model and virtual_model ~= '' and existing_model ~= virtual_model then return -3 end
local result = 0
if old_epoch then
  old_epoch = tonumber(old_epoch)
  if new_epoch < old_epoch then return -1 end
  if new_epoch == old_epoch then
    if redis.call('HGET', prefix_key, 'prefix') ~= prefix_json then return -2 end
    result = 2
  else
    result = 1
  end
end
local created = (result == 2 and old_created or now)
redis.call('HSET', prefix_key, 'epoch', new_epoch, 'prefix', prefix_json, 'created_at', created, 'last_accessed_at', now)
if idle_ttl > 0 then redis.call('EXPIRE', prefix_key, idle_ttl) end
if virtual_model ~= '' then
  redis.call('HSET', binding_key, 'virtual_model_id', virtual_model, 'epoch', new_epoch, 'created_at', created, 'last_accessed_at', now)
  if idle_ttl > 0 then redis.call('EXPIRE', binding_key, idle_ttl) end
elseif existing_model then
  redis.call('HSET', binding_key, 'epoch', new_epoch, 'created_at', created, 'last_accessed_at', now)
  if idle_ttl > 0 then redis.call('EXPIRE', binding_key, idle_ttl) end
end
return result"#,
            ),
            delete_script: Script::new("redis.call('DEL', KEYS[1], KEYS[2]); return 1"),
        })
    }

    fn key(&self, key: &SessionKey) -> String {
        format!("{}{}", self.key_prefix, gateway_key(key).storage_key())
    }

    fn now() -> anyhow::Result<i64> {
        Ok(SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| anyhow::anyhow!("system clock is before UNIX epoch: {error}"))?
            .as_secs() as i64)
    }

    fn get(
        &self,
        key: &SessionKey,
        expected_epoch: Option<u64>,
        reject_stale_epoch: bool,
    ) -> anyhow::Result<Option<String>> {
        let redis_key = self.key(key);
        let mut connection = self.client.get_connection()?;
        let fields: Vec<(String, String)> = connection.hgetall(&redis_key)?;
        if fields.is_empty() {
            return Ok(None);
        }
        let values = fields.into_iter().collect::<HashMap<_, _>>();
        let now = Self::now()?;
        let created_at = values
            .get("created_at")
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(now);
        if self
            .max_lifetime
            .is_some_and(|lifetime| now.saturating_sub(created_at) >= lifetime.as_secs() as i64)
        {
            let _: i32 = connection.del(&redis_key)?;
            return Ok(None);
        }
        let virtual_model_id = values.get("virtual_model_id").cloned();
        let binding_epoch = values
            .get("epoch")
            .and_then(|value| value.parse::<u64>().ok());
        if binding_epoch.is_none() {
            if let Some(epoch) = expected_epoch {
                let _: () = connection.hset(&redis_key, "epoch", epoch)?;
            }
        }
        if reject_stale_epoch
            && expected_epoch.is_some()
            && binding_epoch.is_some()
            && binding_epoch != expected_epoch
        {
            return Err(anyhow::anyhow!("Virtual Model binding epoch is stale"));
        }
        if virtual_model_id.is_some() {
            if let Some(ttl) = self.idle_ttl {
                let _: bool = connection.expire(&redis_key, ttl.as_secs().max(1) as i64)?;
            }
            let _: () = connection.hset(&redis_key, "last_accessed_at", now)?;
        }
        Ok(virtual_model_id)
    }

    fn publish(
        &self,
        key: &SessionKey,
        prefix_key: &str,
        prefix: &SessionPrefix,
        virtual_model_id: Option<&str>,
    ) -> anyhow::Result<PublishResult> {
        let mut connection = self.client.get_connection()?;
        let now = Self::now()?;
        let idle_ttl = self.idle_ttl.map_or(0, |value| value.as_secs().max(1));
        let max_lifetime = self.max_lifetime.map_or(0, |value| value.as_secs().max(1));
        let prefix_json = serde_json::to_string(prefix)?;
        let result: i32 = self
            .publish_script
            .key(prefix_key)
            .key(self.key(key))
            .arg(prefix.epoch)
            .arg(prefix_json)
            .arg(now)
            .arg(idle_ttl)
            .arg(max_lifetime)
            .arg(virtual_model_id.unwrap_or_default())
            .invoke(&mut connection)?;
        match result {
            0 => Ok(PublishResult::Created),
            1 => Ok(PublishResult::Replaced),
            2 => Ok(PublishResult::AlreadyCurrent),
            -1 => Err(anyhow::anyhow!("stale epoch")),
            -2 => Err(anyhow::anyhow!("epoch conflict")),
            -3 => Err(anyhow::anyhow!("virtual model binding conflict")),
            other => Err(anyhow::anyhow!("unexpected publish result: {other}")),
        }
    }

    fn delete(&self, key: &SessionKey, prefix_key: &str) -> anyhow::Result<()> {
        let mut connection = self.client.get_connection()?;
        let _: i32 = self
            .delete_script
            .key(prefix_key)
            .key(self.key(key))
            .invoke(&mut connection)?;
        Ok(())
    }

    fn purge_expired(&self) -> anyhow::Result<usize> {
        let mut connection = self.client.get_connection()?;
        let pattern = format!("{}*", self.key_prefix);
        let mut cursor = 0u64;
        let now = Self::now()?;
        let mut removed = 0;
        loop {
            let (next, keys): (u64, Vec<String>) = redis::cmd("SCAN")
                .arg(cursor)
                .arg("MATCH")
                .arg(&pattern)
                .arg("COUNT")
                .arg(100)
                .query(&mut connection)?;
            for key in keys {
                let created_at: Option<String> = connection.hget(&key, "created_at")?;
                if self.max_lifetime.is_some_and(|lifetime| {
                    created_at
                        .as_deref()
                        .and_then(|value| value.parse::<i64>().ok())
                        .is_some_and(|created| {
                            now.saturating_sub(created) >= lifetime.as_secs() as i64
                        })
                }) {
                    let deleted: i32 = connection.del(key)?;
                    removed += deleted as usize;
                }
            }
            cursor = next;
            if cursor == 0 {
                break;
            }
        }
        Ok(removed)
    }
}

impl Default for WarmStore {
    fn default() -> Self {
        Self::new()
    }
}

impl WarmStore {
    pub fn new() -> Self {
        Self::with_config(&WarmConfig::default())
    }

    pub fn with_config(config: &WarmConfig) -> Self {
        Self::try_with_config(config).expect("failed to initialize configured Warm session store")
    }

    pub fn try_with_config(config: &WarmConfig) -> anyhow::Result<Self> {
        let redis_key_prefix = normalize_key_prefix(&config.redis_key_prefix)?;
        let session_config = config.session_store_config();
        let store: Arc<dyn SessionStore> = match config.redis_url.as_deref() {
            Some(redis_url) => {
                let redis_config = unigateway_session_redis::RedisSessionStoreConfig {
                    key_prefix: redis_key_prefix.clone(),
                    ..session_config.clone().into()
                };
                Arc::new(
                    unigateway_session_redis::RedisSessionStore::with_config(
                        redis_url,
                        redis_config,
                    )
                    .map_err(|error| {
                        anyhow::anyhow!("failed to initialize Warm Redis session store: {error}")
                    })?,
                )
            }
            None => Arc::new(MemorySessionStore::with_config(session_config.clone())),
        };
        let binding_store = config
            .redis_url
            .as_deref()
            .map(|redis_url| {
                RedisBindingStore::open(redis_url, &redis_key_prefix, &session_config.lifetime)
            })
            .transpose()
            .map_err(|error| anyhow::anyhow!("failed to initialize Warm binding store: {error}"))?
            .map(Arc::new);
        Ok(Self {
            store,
            size_limits: session_config.size_limits,
            middleware_config: SessionMiddlewareConfig {
                tail_position_policy: TailPositionPolicy::ExactPrefixLength,
                fingerprint_policy: FingerprintPolicy::Optional,
                size_limits: session_config.size_limits,
                touch_on_delta: session_config.lifetime.touch_on_read,
                ..SessionMiddlewareConfig::default()
            },
            virtual_models: Mutex::new(HashMap::new()),
            binding_store,
            redis_key_prefix,
            publish_lock: Mutex::new(()),
            metrics: WarmMetrics::new(),
        })
    }

    pub fn with_session_config(config: SessionStoreConfig) -> Self {
        Self {
            store: Arc::new(MemorySessionStore::with_config(config.clone())),
            size_limits: config.size_limits,
            middleware_config: SessionMiddlewareConfig {
                tail_position_policy: TailPositionPolicy::ExactPrefixLength,
                fingerprint_policy: FingerprintPolicy::Optional,
                size_limits: config.size_limits,
                touch_on_delta: config.lifetime.touch_on_read,
                ..SessionMiddlewareConfig::default()
            },
            virtual_models: Mutex::new(HashMap::new()),
            binding_store: None,
            redis_key_prefix: "smartgate:warm:".to_string(),
            publish_lock: Mutex::new(()),
            metrics: WarmMetrics::new(),
        }
    }

    pub fn session_store(&self) -> Arc<dyn SessionStore> {
        self.store.clone()
    }

    /// Builds the request middleware chain for one authenticated SmartGate request.
    /// The resolver is request-scoped so an untrusted client cannot choose a namespace.
    pub fn host_middleware(&self, key: &SessionKey) -> HostMiddleware {
        let namespace_key = key.clone();
        let resolver: SessionKeyResolver = Arc::new(move |_host, context| {
            gateway_key(&SessionKey {
                project_id: namespace_key.project_id.clone(),
                api_key_id: namespace_key.api_key_id.clone(),
                session_id: context.session_id.clone(),
            })
        });
        let mut config = self.middleware_config.clone();
        config.key_resolver = resolver;
        HostMiddleware::new().with_request(Arc::new(DeltaAssemblyMiddleware::with_store(
            self.session_store(),
            config,
        )))
    }

    pub fn metrics(&self) -> Arc<WarmMetrics> {
        self.metrics.clone()
    }

    pub fn record_publish_failure(&self) {
        self.metrics
            .publish_failures
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_delta_attempt(&self, delivery: Delivery) {
        match delivery {
            Delivery::Full => self.metrics.full_deliveries.fetch_add(1, Ordering::Relaxed),
            Delivery::Delta => self.metrics.delta_attempts.fetch_add(1, Ordering::Relaxed),
        };
    }

    pub fn record_delta_result(&self, success: bool) {
        let counter = if success {
            &self.metrics.delta_successes
        } else {
            &self.metrics.delta_failures
        };
        counter.fetch_add(1, Ordering::Relaxed);
    }

    fn binding_for(
        &self,
        key: &SessionKey,
        reject_stale_epoch: bool,
    ) -> Result<Option<String>, WarmError> {
        if let Some(binding_store) = &self.binding_store {
            let expected_epoch = self
                .store
                .get_key(&gateway_key(key))
                .map_err(map_session_error)?
                .map(|prefix| prefix.epoch);
            let Some(expected_epoch) = expected_epoch else {
                return Ok(None);
            };
            binding_store
                .get(key, Some(expected_epoch), reject_stale_epoch)
                .map_err(|error| WarmError::StoreUnavailable(error.to_string()))
        } else {
            Ok(self
                .virtual_models
                .lock()
                .map_err(|_| {
                    WarmError::StoreUnavailable("binding store lock poisoned".to_string())
                })?
                .get(key)
                .cloned()
                .flatten())
        }
    }

    fn remove_binding(&self, key: &SessionKey) -> Result<(), WarmError> {
        if let Some(binding_store) = &self.binding_store {
            let prefix_key = format!(
                "{}{}",
                self.redis_key_prefix,
                gateway_key(key).storage_key()
            );
            binding_store
                .delete(key, &prefix_key)
                .map_err(|error| WarmError::StoreUnavailable(error.to_string()))
        } else {
            self.virtual_models
                .lock()
                .map_err(|_| {
                    WarmError::StoreUnavailable("binding store lock poisoned".to_string())
                })?
                .remove(key);
            Ok(())
        }
    }

    pub fn validate_virtual_model(
        &self,
        key: &SessionKey,
        requested_virtual_model_id: Option<&str>,
    ) -> Result<(), WarmError> {
        let binding = self.binding_for(key, true)?;
        if let (Some(bound), Some(requested)) = (binding.as_deref(), requested_virtual_model_id) {
            if bound != requested {
                self.metrics
                    .virtual_model_mismatches
                    .fetch_add(1, Ordering::Relaxed);
                return Err(WarmError::VirtualModelMismatch);
            }
        }
        Ok(())
    }

    pub fn publish(
        &self,
        key: SessionKey,
        input: PublishInput,
    ) -> Result<PrefixSnapshot, WarmError> {
        let _publish_guard = self
            .publish_lock
            .lock()
            .map_err(|_| WarmError::StoreUnavailable("publish lock poisoned".to_string()))?;
        self.metrics
            .publish_attempts
            .fetch_add(1, Ordering::Relaxed);
        validate_publish(&input)?;
        if let Some(virtual_model_id) = input.virtual_model_id.as_deref() {
            validate_virtual_model_id(virtual_model_id)?;
        }
        let computed_hash = fingerprint_messages(&input.messages);
        if let Some(client_hash) = &input.prefix_hash {
            if client_hash != &computed_hash {
                return Err(WarmError::PrefixHashMismatch);
            }
        }

        let gateway_key = gateway_key(&key);
        let existing_binding = self.binding_for(&key, false)?;
        if let (Some(existing), Some(incoming)) = (
            existing_binding.as_deref(),
            input.virtual_model_id.as_deref(),
        ) {
            if existing != incoming {
                return Err(WarmError::VirtualModelMismatch);
            }
        }

        let existing = match self.store.get_key(&gateway_key) {
            Ok(prefix) => prefix,
            Err(SessionError::Expired(_)) => {
                self.remove_binding(&key)?;
                None
            }
            Err(error) => return Err(map_session_error(error)),
        };
        let effective_virtual_model = input.virtual_model_id.clone().or(existing_binding);
        if effective_virtual_model.is_none() {
            // The API layer controls strict mode; unbound legacy sessions remain compatible.
        }
        let prefix = SessionPrefix {
            epoch: to_gateway_epoch(input.epoch)?,
            messages: input.messages,
            pinned_boundary: Some(input.pinned_boundary as u64),
            fingerprint: Some(Fingerprint {
                algorithm: HASH_ALGORITHM_VERSION.to_string(),
                value: computed_hash,
            }),
            message_count: Some(input.message_count as u64),
        };
        self.size_limits
            .validate_prefix(&gateway_key, &prefix.messages)
            .map_err(map_session_error)?;

        let result = if let Some(binding_store) = &self.binding_store {
            let prefix_key = format!(
                "{}{}",
                self.redis_key_prefix,
                GatewaySessionKey::new(
                    format!(
                        "smartgate:v1:{}:{}",
                        encode_namespace_component(&key.project_id),
                        encode_namespace_component(&key.api_key_id)
                    ),
                    key.session_id.clone(),
                )
                .storage_key()
            );
            binding_store
                .publish(
                    &key,
                    &prefix_key,
                    &prefix,
                    effective_virtual_model.as_deref(),
                )
                .map_err(map_redis_publish_error)?
        } else {
            self.store
                .publish_key(&gateway_key, prefix)
                .map_err(map_session_error)?
        };

        if self.binding_store.is_none() {
            if let Some(virtual_model_id) = effective_virtual_model.as_deref() {
                self.virtual_models
                    .lock()
                    .map_err(|_| {
                        WarmError::StoreUnavailable("binding store lock poisoned".to_string())
                    })?
                    .insert(key.clone(), Some(virtual_model_id.to_string()));
            }
        }
        let stored = self
            .store
            .get_key(&gateway_key)
            .map_err(map_session_error)?
            .or(existing)
            .ok_or(WarmError::SessionNotFound)?;
        let _ = result;
        self.metrics
            .publish_successes
            .fetch_add(1, Ordering::Relaxed);
        Ok(to_snapshot(stored, effective_virtual_model))
    }

    pub fn get(&self, key: &SessionKey) -> Option<PrefixSnapshot> {
        let gateway_key = gateway_key(key);
        match self.store.get_key(&gateway_key) {
            Ok(Some(prefix)) => {
                let binding = self.binding_for(key, true).ok().flatten();
                Some(to_snapshot(prefix, binding))
            }
            Ok(None) | Err(SessionError::Expired(_)) => {
                let _ = self.remove_binding(key);
                None
            }
            Err(_) => None,
        }
    }

    pub fn delete(&self, key: &SessionKey) {
        let _publish_guard = self.publish_lock.lock().ok();
        let gateway_key = gateway_key(key);
        if let Some(binding_store) = &self.binding_store {
            let prefix_key = format!("{}{}", self.redis_key_prefix, gateway_key.storage_key());
            let _ = binding_store.delete(key, &prefix_key);
        } else {
            let _ = self.store.delete_key(&gateway_key);
            let _ = self.remove_binding(key);
        }
    }

    /// Removes expired snapshots and their SmartGate-only model bindings.
    pub fn purge_expired(&self) -> Result<usize, WarmError> {
        self.metrics.cleanup_runs.fetch_add(1, Ordering::Relaxed);
        let removed = self.store.purge_expired().map_err(|error| {
            self.metrics
                .cleanup_failures
                .fetch_add(1, Ordering::Relaxed);
            map_session_error(error)
        })?;
        if let Some(binding_store) = &self.binding_store {
            let binding_removed = binding_store.purge_expired().map_err(|error| {
                self.metrics
                    .cleanup_failures
                    .fetch_add(1, Ordering::Relaxed);
                WarmError::StoreUnavailable(error.to_string())
            })?;
            self.metrics
                .sessions_removed
                .fetch_add((removed + binding_removed) as u64, Ordering::Relaxed);
            return Ok(removed);
        }
        let keys = self
            .virtual_models
            .lock()
            .map_err(|_| WarmError::StoreUnavailable("binding store lock poisoned".to_string()))?
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        let expired = keys
            .into_iter()
            .filter(|key| self.get(key).is_none())
            .collect::<Vec<_>>();
        if !expired.is_empty() {
            let mut bindings = self.virtual_models.lock().map_err(|_| {
                WarmError::StoreUnavailable("binding store lock poisoned".to_string())
            })?;
            for key in expired {
                bindings.remove(&key);
            }
        }
        Ok(removed)
    }

    pub fn assemble_delta(
        &self,
        key: &SessionKey,
        context: &WarmContext,
        tail: Vec<Value>,
        virtual_model_id: Option<&str>,
    ) -> Result<Vec<Value>, WarmError> {
        let gateway_key = gateway_key(key);
        let snapshot = match self.store.get_key(&gateway_key) {
            Ok(Some(prefix)) => prefix,
            Ok(None) => return Err(WarmError::SessionNotFound),
            Err(SessionError::Expired(_)) => {
                let _ = self.remove_binding(key);
                return Err(WarmError::SessionExpired);
            }
            Err(error) => return Err(map_session_error(error)),
        };
        self.validate_virtual_model(key, virtual_model_id)?;
        let expected_epoch = i64::try_from(snapshot.epoch)
            .map_err(|_| WarmError::InvalidContext("stored epoch is too large".to_string()))?;
        if context.epoch != Some(expected_epoch) {
            return Err(WarmError::EpochMismatch);
        }
        if let Some(request_hash) = &context.prefix_hash {
            let request = Fingerprint {
                algorithm: String::new(),
                value: request_hash.clone(),
            };
            if snapshot
                .fingerprint
                .as_ref()
                .is_none_or(|stored| !fingerprints_match(stored, &request))
            {
                return Err(WarmError::PrefixHashMismatch);
            }
        }
        let expected_tail_start = snapshot
            .message_count
            .unwrap_or(snapshot.messages.len() as u64) as usize;
        let actual_tail_start = context.tail_start.ok_or_else(|| {
            WarmError::InvalidContext("delta delivery requires tail_start".to_string())
        })?;
        if actual_tail_start != expected_tail_start {
            return Err(WarmError::TailStartMismatch {
                expected: expected_tail_start,
                actual: actual_tail_start,
            });
        }
        self.size_limits
            .validate_tail(&gateway_key, &tail)
            .map_err(map_session_error)?;
        let mut messages = snapshot.messages;
        messages.extend(tail);
        self.size_limits
            .validate_assembled(&gateway_key, &messages)
            .map_err(map_session_error)?;
        Ok(messages)
    }
}

fn gateway_key(key: &SessionKey) -> GatewaySessionKey {
    GatewaySessionKey::new(
        format!(
            "smartgate:v1:{}:{}",
            encode_namespace_component(&key.project_id),
            encode_namespace_component(&key.api_key_id)
        ),
        key.session_id.clone(),
    )
}

fn encode_namespace_component(value: &str) -> String {
    format!("{}:{}", value.len(), value)
}

fn to_gateway_epoch(epoch: i64) -> Result<u64, WarmError> {
    u64::try_from(epoch)
        .map_err(|_| WarmError::InvalidPublish("epoch must be non-negative".to_string()))
}

fn to_snapshot(prefix: SessionPrefix, virtual_model_id: Option<String>) -> PrefixSnapshot {
    let prefix_hash = prefix
        .fingerprint
        .as_ref()
        .map(|fingerprint| fingerprint.value.clone())
        .unwrap_or_else(|| fingerprint_messages(&prefix.messages));
    PrefixSnapshot {
        epoch: prefix.epoch as i64,
        prefix_hash,
        message_count: prefix.message_count.unwrap_or(prefix.messages.len() as u64) as usize,
        messages: prefix.messages,
        pinned_boundary: prefix.pinned_boundary.unwrap_or_default() as usize,
        virtual_model_id,
    }
}

fn map_redis_publish_error(error: anyhow::Error) -> WarmError {
    let message = error.to_string();
    if message.contains("stale epoch") {
        WarmError::StaleEpoch
    } else if message.contains("epoch conflict") {
        WarmError::EpochConflict
    } else if message.contains("virtual model binding conflict") {
        WarmError::VirtualModelMismatch
    } else {
        WarmError::StoreUnavailable(message)
    }
}

fn map_session_error(error: SessionError) -> WarmError {
    match error {
        SessionError::Expired(_) => WarmError::SessionExpired,
        SessionError::StaleEpoch { .. } => WarmError::StaleEpoch,
        SessionError::EpochConflict { .. } => WarmError::EpochConflict,
        SessionError::EpochMismatch { .. } => WarmError::EpochMismatch,
        SessionError::FingerprintMismatch { .. } => WarmError::PrefixHashMismatch,
        SessionError::TailStartMismatch {
            expected, actual, ..
        } => WarmError::TailStartMismatch {
            expected: expected as usize,
            actual: actual as usize,
        },
        SessionError::PrefixTooLarge { .. } => WarmError::PrefixTooLarge,
        SessionError::TailTooLarge { .. } => WarmError::TailTooLarge,
        SessionError::AssembledTooLarge { .. } => WarmError::AssembledTooLarge,
        SessionError::InvalidContext(message) => WarmError::InvalidContext(message),
        SessionError::Unavailable(message) => WarmError::StoreUnavailable(message),
        SessionError::NotFound(_) => WarmError::SessionNotFound,
    }
}

pub fn parse_context(payload: &Value) -> Result<Option<WarmContext>, WarmError> {
    parse_context_with_headers(payload, None)
}

pub fn parse_context_with_headers(
    payload: &Value,
    headers: Option<&HeaderMap>,
) -> Result<Option<WarmContext>, WarmError> {
    let body_object = payload
        .get("_zene_context")
        .map(|raw| {
            raw.as_object().ok_or_else(|| {
                WarmError::InvalidContext("_zene_context must be an object".to_string())
            })
        })
        .transpose()?;
    let header_value = |name: &str| {
        headers
            .and_then(|headers| headers.get(name))
            .and_then(|value| value.to_str().ok())
            .map(ToOwned::to_owned)
    };
    let resolve_string = |body_name: &str, header_name: &str| {
        let body_value = match body_object {
            Some(object) => string_field(object, body_name)?,
            None => None,
        };
        let header_value = header_value(header_name);
        if body_value.is_some() && header_value.is_some() && body_value != header_value {
            return Err(WarmError::InvalidContext(format!(
                "header {header_name} conflicts with _zene_context.{body_name}"
            )));
        }
        Ok(header_value.or(body_value))
    };
    let resolve_integer = |body_name: &str, header_name: &str| {
        let body_value = match body_object {
            Some(object) => integer_field(object, body_name)?,
            None => None,
        };
        let header_value = header_value(header_name)
            .map(|value| {
                value.parse::<i64>().map_err(|_| {
                    WarmError::InvalidContext(format!("header {header_name} must be an integer"))
                })
            })
            .transpose()?;
        if body_value.is_some() && header_value.is_some() && body_value != header_value {
            return Err(WarmError::InvalidContext(format!(
                "header {header_name} conflicts with _zene_context.{body_name}"
            )));
        }
        Ok(header_value.or(body_value))
    };
    let has_context = body_object.is_some()
        || headers.is_some_and(|headers| {
            [
                "x-zene-session-id",
                "x-zene-context-epoch",
                "x-zene-context-delivery",
                "x-zene-prefix-hash",
                "x-zene-tail-start",
                "x-zene-request-id",
            ]
            .iter()
            .any(|name| headers.contains_key(*name))
        });
    if !has_context {
        return Ok(None);
    }
    let session_id = resolve_string("session_id", "x-zene-session-id")?;
    let delivery = match resolve_string("delivery", "x-zene-context-delivery")?.as_deref() {
        None | Some("full") => Delivery::Full,
        Some("delta") => Delivery::Delta,
        Some(value) => {
            return Err(WarmError::InvalidContext(format!(
                "unsupported delivery: {value}"
            )))
        }
    };
    if delivery == Delivery::Delta && session_id.is_none() {
        return Err(WarmError::InvalidContext(
            "delta delivery requires session_id".to_string(),
        ));
    }
    let epoch = resolve_integer("context_epoch", "x-zene-context-epoch")?;
    let tail_start = resolve_integer("tail_start", "x-zene-tail-start")?
        .map(|value| {
            usize::try_from(value).map_err(|_| {
                WarmError::InvalidContext("tail_start must be a non-negative integer".to_string())
            })
        })
        .transpose()?;
    Ok(Some(WarmContext {
        session_id,
        epoch,
        delivery,
        prefix_hash: resolve_string("prefix_hash", "x-zene-prefix-hash")?,
        tail_start,
        request_id: resolve_string("request_id", "x-zene-request-id")?,
    }))
}

pub fn strip_context(payload: &mut Value) {
    if let Some(object) = payload.as_object_mut() {
        object.remove("_zene_context");
    }
}

/// Converts SmartGate's legacy Zene context into UniGateway's generic gateway
/// field consumed by DeltaAssemblyMiddleware.
pub fn install_session_gateway_context(
    request: &mut unigateway_sdk::core::ProxyChatRequest,
    context: Option<&WarmContext>,
) -> Result<(), WarmError> {
    request.gateway_fields.remove("_zene_context");
    let Some(context) = context else {
        request.gateway_fields.remove(SESSION_GATEWAY_FIELD);
        return Ok(());
    };
    if context.delivery == Delivery::Full {
        request.gateway_fields.remove(SESSION_GATEWAY_FIELD);
        return Ok(());
    }
    let session_id = context.session_id.clone().ok_or_else(|| {
        WarmError::InvalidContext("delta delivery requires session_id".to_string())
    })?;
    let epoch = context.epoch.ok_or_else(|| {
        WarmError::InvalidContext("delta delivery requires context_epoch".to_string())
    })?;
    if epoch < 0 {
        return Err(WarmError::InvalidContext(
            "context_epoch must be non-negative".to_string(),
        ));
    }
    let mut gateway_context = json!({
        "session_id": session_id,
        "epoch": epoch,
        "delivery": "delta",
    });
    let object = gateway_context.as_object_mut().expect("object literal");
    if let Some(prefix_hash) = &context.prefix_hash {
        object.insert(
            "prefix_hash".to_string(),
            Value::String(prefix_hash.clone()),
        );
    }
    if let Some(tail_start) = context.tail_start {
        object.insert("tail_start".to_string(), json!(tail_start));
    }
    request
        .gateway_fields
        .insert(SESSION_GATEWAY_FIELD.to_string(), gateway_context);
    Ok(())
}

pub fn fingerprint_messages(messages: &[Value]) -> String {
    let mut hasher = DefaultHasher::new();
    for message in messages {
        let selected = json!({
            "role": message.get("role"),
            "content": message.get("content"),
            "tool_calls": message.get("tool_calls"),
            "name": message.get("name"),
        });
        hasher.write(
            serde_json::to_string(&selected)
                .unwrap_or_default()
                .as_bytes(),
        );
    }
    format!("{:016x}", hasher.finish())
}

fn validate_virtual_model_id(value: &str) -> Result<(), WarmError> {
    if value.trim().is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
        return Err(WarmError::InvalidPublish(
            "virtual_model must be 1-256 non-control characters".to_string(),
        ));
    }
    Ok(())
}

fn validate_publish(input: &PublishInput) -> Result<(), WarmError> {
    if input.epoch < 0 {
        return Err(WarmError::InvalidPublish(
            "epoch must be non-negative".to_string(),
        ));
    }
    if input.message_count != input.messages.len() {
        return Err(WarmError::InvalidPublish(
            "message_count must equal messages.length".to_string(),
        ));
    }
    if input.pinned_boundary > input.message_count {
        return Err(WarmError::InvalidPublish(
            "pinned_boundary must not exceed message_count".to_string(),
        ));
    }
    Ok(())
}

fn string_field(object: &Map<String, Value>, name: &str) -> Result<Option<String>, WarmError> {
    match object.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_str()
            .map(ToOwned::to_owned)
            .map(Some)
            .ok_or_else(|| WarmError::InvalidContext(format!("{name} must be a string"))),
    }
}

fn integer_field(object: &Map<String, Value>, name: &str) -> Result<Option<i64>, WarmError> {
    match object.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_i64()
            .map(Some)
            .ok_or_else(|| WarmError::InvalidContext(format!("{name} must be an integer"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    use std::time::Duration;

    fn key() -> SessionKey {
        SessionKey {
            project_id: "project".to_string(),
            api_key_id: "key".to_string(),
            session_id: "session".to_string(),
        }
    }

    fn publish(epoch: i64, messages: Vec<Value>) -> PublishInput {
        PublishInput {
            epoch,
            message_count: messages.len(),
            messages,
            pinned_boundary: 0,
            prefix_hash: None,
            virtual_model_id: Some("vm".to_string()),
        }
    }

    #[test]
    fn publish_is_idempotent_and_monotonic() {
        let store = WarmStore::new();
        let messages = vec![json!({"role": "system", "content": "hi"})];
        store.publish(key(), publish(1, messages.clone())).unwrap();
        store.publish(key(), publish(1, messages)).unwrap();
        assert_eq!(
            store.publish(key(), publish(0, vec![])),
            Err(WarmError::StaleEpoch)
        );
    }

    #[test]
    fn namespace_isolates_same_session_id() {
        let store = WarmStore::new();
        let mut other = key();
        other.project_id = "other-project".to_string();
        store
            .publish(key(), publish(1, vec![json!({"content": "a"})]))
            .unwrap();
        store
            .publish(other.clone(), publish(1, vec![json!({"content": "b"})]))
            .unwrap();
        assert_eq!(store.get(&key()).unwrap().messages[0]["content"], "a");
        assert_eq!(store.get(&other).unwrap().messages[0]["content"], "b");
    }

    #[test]
    fn same_epoch_with_different_content_conflicts() {
        let store = WarmStore::new();
        store
            .publish(
                key(),
                publish(1, vec![json!({"role": "user", "content": "a"})]),
            )
            .unwrap();
        assert_eq!(
            store.publish(
                key(),
                publish(1, vec![json!({"role": "user", "content": "b"})])
            ),
            Err(WarmError::EpochConflict)
        );
    }

    #[test]
    fn virtual_model_binding_is_enforced() {
        let store = WarmStore::new();
        store
            .publish(key(), publish(1, vec![json!({"content": "a"})]))
            .unwrap();
        assert_eq!(
            store.publish(
                key(),
                PublishInput {
                    virtual_model_id: Some("other-vm".to_string()),
                    ..publish(2, vec![json!({"content": "b"})])
                },
            ),
            Err(WarmError::VirtualModelMismatch)
        );
    }

    #[test]
    fn configured_ttl_expires_session() {
        let store = WarmStore::with_session_config(SessionStoreConfig {
            lifetime: unigateway_sdk::session::SessionLifetime {
                idle_ttl: Some(Duration::from_millis(10)),
                max_lifetime: None,
                touch_on_read: false,
            },
            ..Default::default()
        });
        store
            .publish(key(), publish(1, vec![json!({"content": "a"})]))
            .unwrap();
        thread::sleep(Duration::from_millis(20));
        assert_eq!(
            store.assemble_delta(
                &key(),
                &WarmContext {
                    session_id: Some(key().session_id),
                    epoch: Some(1),
                    delivery: Delivery::Delta,
                    prefix_hash: None,
                    tail_start: Some(1),
                    request_id: None,
                },
                vec![],
                Some("vm"),
            ),
            Err(WarmError::SessionExpired)
        );
        assert_eq!(store.get(&key()), None);
    }

    #[test]
    fn purge_expired_removes_store_snapshot_and_binding() {
        let store = WarmStore::with_session_config(SessionStoreConfig {
            lifetime: unigateway_sdk::session::SessionLifetime {
                idle_ttl: Some(Duration::from_millis(10)),
                max_lifetime: None,
                touch_on_read: false,
            },
            ..Default::default()
        });
        store
            .publish(key(), publish(1, vec![json!({"content": "a"})]))
            .unwrap();
        thread::sleep(Duration::from_millis(20));
        assert_eq!(store.purge_expired().unwrap(), 1);
        assert_eq!(store.get(&key()), None);
    }

    #[test]
    fn configured_assembled_limit_is_enforced() {
        let store = WarmStore::with_session_config(SessionStoreConfig {
            size_limits: SessionSizeLimits {
                max_assembled_bytes: Some(40),
                ..Default::default()
            },
            ..Default::default()
        });
        store
            .publish(key(), publish(1, vec![json!({"content": "prefix"})]))
            .unwrap();
        let context = WarmContext {
            session_id: Some("session".to_string()),
            epoch: Some(1),
            delivery: Delivery::Delta,
            prefix_hash: None,
            tail_start: Some(1),
            request_id: None,
        };
        assert_eq!(
            store.assemble_delta(
                &key(),
                &context,
                vec![json!({"content": "tail that exceeds the configured limit"})],
                Some("vm"),
            ),
            Err(WarmError::AssembledTooLarge)
        );
    }

    #[test]
    #[ignore = "requires REDIS_URL and a running Redis server"]
    fn redis_persists_virtual_model_binding_across_store_instances() {
        let redis_url = std::env::var("REDIS_URL").expect("REDIS_URL must be set");
        let session_id = format!("redis-redeploy-{}", std::process::id());
        let key = SessionKey {
            project_id: "redis-project".to_string(),
            api_key_id: "redis-key".to_string(),
            session_id,
        };
        let config = WarmConfig {
            redis_url: Some(redis_url),
            redis_key_prefix: format!("smartgate:test:{}:", std::process::id()),
            ..WarmConfig::default()
        };
        let first = WarmStore::try_with_config(&config).unwrap();
        first
            .publish(
                key.clone(),
                PublishInput {
                    epoch: 1,
                    message_count: 1,
                    messages: vec![json!({"role": "system", "content": "redis"})],
                    pinned_boundary: 1,
                    prefix_hash: None,
                    virtual_model_id: Some("virtual-model-redis".to_string()),
                },
            )
            .unwrap();
        assert_eq!(
            first
                .validate_virtual_model(&key, Some("wrong-model"))
                .unwrap_err(),
            WarmError::VirtualModelMismatch
        );

        let reloaded = WarmStore::try_with_config(&config).unwrap();
        assert_eq!(
            reloaded.get(&key).unwrap().virtual_model_id.as_deref(),
            Some("virtual-model-redis")
        );
        reloaded
            .validate_virtual_model(&key, Some("virtual-model-redis"))
            .unwrap();
        assert_eq!(
            reloaded
                .publish(
                    key.clone(),
                    PublishInput {
                        epoch: 2,
                        message_count: 1,
                        messages: vec![json!({"role": "system", "content": "replaced"})],
                        pinned_boundary: 1,
                        prefix_hash: None,
                        virtual_model_id: Some("wrong-model".to_string()),
                    },
                )
                .unwrap_err(),
            WarmError::VirtualModelMismatch
        );
        assert_eq!(reloaded.get(&key).unwrap().messages[0]["content"], "redis");
        let context = WarmContext {
            session_id: Some(key.session_id.clone()),
            epoch: Some(1),
            delivery: Delivery::Delta,
            prefix_hash: None,
            tail_start: Some(1),
            request_id: None,
        };
        assert_eq!(
            reloaded
                .assemble_delta(
                    &key,
                    &context,
                    vec![json!({"role": "user", "content": "after redeploy"})],
                    Some("virtual-model-redis"),
                )
                .unwrap()
                .len(),
            2
        );
        reloaded.delete(&key);
    }

    #[test]
    fn metrics_snapshot_has_bounded_warm_counters() {
        let store = WarmStore::new();
        store
            .publish(key(), publish(1, vec![json!({"content": "metrics"})]))
            .unwrap();
        let snapshot = store.metrics().snapshot();
        assert_eq!(snapshot["publish_attempts"], 1);
        assert_eq!(snapshot["publish_successes"], 1);
        assert!(snapshot.get("delta_attempts").is_some());
        assert!(snapshot.get("full_deliveries").is_some());
    }

    #[test]
    fn custom_key_prefix_is_normalized() {
        assert_eq!(normalize_key_prefix("tenant-a").unwrap(), "tenant-a:");
        assert!(normalize_key_prefix("").is_err());
        assert!(normalize_key_prefix("bad\nkey").is_err());
    }

    #[test]
    fn virtual_model_id_is_bounded() {
        assert!(validate_virtual_model_id("vm").is_ok());
        assert!(validate_virtual_model_id("").is_err());
        assert!(validate_virtual_model_id(&"x".repeat(257)).is_err());
        assert!(validate_virtual_model_id("vm\ninvalid").is_err());
    }

    #[test]
    fn zene_context_is_installed_as_unigateway_gateway_field() {
        let mut request = unigateway_sdk::core::ProxyChatRequest {
            model: "vm".to_string(),
            messages: vec![],
            temperature: None,
            top_p: None,
            top_k: None,
            max_tokens: None,
            stop_sequences: None,
            stream: false,
            system: None,
            tools: None,
            tool_choice: None,
            raw_messages: Some(json!([{"content": "tail"}])),
            gateway_fields: HashMap::new(),
            extra: HashMap::new(),
            metadata: HashMap::new(),
        };
        install_session_gateway_context(
            &mut request,
            Some(&WarmContext {
                session_id: Some("session".to_string()),
                epoch: Some(3),
                delivery: Delivery::Delta,
                prefix_hash: Some("hash".to_string()),
                tail_start: Some(2),
                request_id: None,
            }),
        )
        .unwrap();
        assert_eq!(
            request.gateway_fields[SESSION_GATEWAY_FIELD]["session_id"],
            "session"
        );
        assert_eq!(request.gateway_fields[SESSION_GATEWAY_FIELD]["epoch"], 3);
        assert_eq!(
            request.gateway_fields[SESSION_GATEWAY_FIELD]["tail_start"],
            2
        );
        assert_eq!(request.raw_messages.unwrap()[0]["content"], "tail");
    }

    #[test]
    fn headers_and_body_must_agree() {
        let payload = json!({
            "_zene_context": {
                "session_id": "body",
                "delivery": "full"
            }
        });
        let mut headers = HeaderMap::new();
        headers.insert("x-zene-session-id", "header".parse().unwrap());
        assert!(matches!(
            parse_context_with_headers(&payload, Some(&headers)),
            Err(WarmError::InvalidContext(_))
        ));
    }

    #[test]
    fn full_delivery_does_not_require_a_session() {
        let context = parse_context(&json!({
            "_zene_context": {"delivery": "full"}
        }))
        .unwrap()
        .unwrap();
        assert_eq!(context.delivery, Delivery::Full);
        assert_eq!(context.session_id, None);
    }

    #[test]
    fn delta_requires_exact_tail_start_and_epoch() {
        let store = WarmStore::new();
        store
            .publish(
                key(),
                PublishInput {
                    epoch: 2,
                    message_count: 1,
                    messages: vec![json!({"role": "system", "content": "hi"})],
                    pinned_boundary: 1,
                    prefix_hash: None,
                    virtual_model_id: Some("vm".to_string()),
                },
            )
            .unwrap();
        let context = WarmContext {
            session_id: Some("session".to_string()),
            epoch: Some(2),
            delivery: Delivery::Delta,
            prefix_hash: None,
            tail_start: Some(1),
            request_id: None,
        };
        let assembled = store
            .assemble_delta(
                &key(),
                &context,
                vec![json!({"role": "user", "content": "x"})],
                Some("vm"),
            )
            .unwrap();
        assert_eq!(assembled.len(), 2);
    }
}
