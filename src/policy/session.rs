//! Session id, context epoch, prefix hash, sticky endpoint binding, and turn indexing.

use axum::http::HeaderMap;
use once_cell::sync::Lazy;
use std::time::{Duration, Instant};

use dashmap::DashMap;

pub const SESSION_HEADER: &str = "x-smartgate-session-id";
pub const EPOCH_HEADER: &str = "x-smartgate-context-epoch";
pub const DELIVERY_HEADER: &str = "x-smartgate-context-delivery";
pub const PREFIX_HASH_HEADER: &str = "x-smartgate-prefix-hash";

const MAX_SESSION_ID_LEN: usize = 128;
const DEFAULT_SESSION_TTL: Duration = Duration::from_secs(3600);

#[derive(Debug, Clone, Hash, Eq, PartialEq)]
struct SessionKey {
    pool_id: String,
    session_id: String,
    epoch: u32,
}

#[derive(Debug, Clone)]
struct SessionEntry {
    turn_count: u32,
    first_prefix_hash: Option<u64>,
    sticky_endpoint_id: Option<String>,
    last_seen: Instant,
    ttl: Duration,
}

static SESSIONS: Lazy<DashMap<SessionKey, SessionEntry>> = Lazy::new(DashMap::new);

/// Validate and normalize a client-provided session id.
pub fn validate_session_id(raw: &str) -> Option<String> {
    let s = raw.trim();
    if s.is_empty() || s.len() > MAX_SESSION_ID_LEN {
        return None;
    }
    if s.chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '-'))
    {
        Some(s.to_string())
    } else {
        None
    }
}

/// Header `X-SmartGate-Session-Id`, then `_smartgate_context.session_id`, then OpenAI `user`.
pub fn extract_session_id(headers: &HeaderMap, payload: &serde_json::Value) -> Option<String> {
    if let Some(v) = headers
        .get(SESSION_HEADER)
        .and_then(|h| h.to_str().ok())
        .and_then(validate_session_id)
    {
        return Some(v);
    }
    if let Some(v) = payload
        .get("_smartgate_context")
        .and_then(|c| c.get("session_id"))
        .and_then(|v| v.as_str())
        .and_then(validate_session_id)
    {
        return Some(v);
    }
    payload
        .get("user")
        .and_then(|u| u.as_str())
        .and_then(validate_session_id)
}

/// Context epoch (default 0). Compact / prefix change should bump epoch on the client.
pub fn extract_context_epoch(headers: &HeaderMap, payload: &serde_json::Value) -> u32 {
    if let Some(v) = headers
        .get(EPOCH_HEADER)
        .and_then(|h| h.to_str().ok())
        .and_then(parse_epoch)
    {
        return v;
    }
    payload
        .get("_smartgate_context")
        .and_then(|c| c.get("epoch"))
        .and_then(parse_epoch_value)
        .unwrap_or(0)
}

pub fn extract_context_delivery(headers: &HeaderMap, payload: &serde_json::Value) -> Option<String> {
    headers
        .get(DELIVERY_HEADER)
        .and_then(|h| h.to_str().ok())
        .map(|s| s.to_string())
        .or_else(|| {
            payload
                .get("_smartgate_context")
                .and_then(|c| c.get("delivery"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
}

fn parse_epoch(raw: &str) -> Option<u32> {
    parse_epoch_value(&serde_json::Value::String(raw.trim().to_string()))
}

fn parse_epoch_value(v: &serde_json::Value) -> Option<u32> {
    match v {
        serde_json::Value::Number(n) => n.as_u64().and_then(|u| u32::try_from(u).ok()),
        serde_json::Value::String(s) => s.trim().parse::<u32>().ok(),
        _ => None,
    }
}

/// Client-provided prefix hash (hex), else computed from messages.
pub fn resolve_prefix_hash(headers: &HeaderMap, payload: &serde_json::Value) -> Option<u64> {
    if let Some(raw) = headers.get(PREFIX_HASH_HEADER).and_then(|h| h.to_str().ok()) {
        if let Some(parsed) = parse_prefix_hash_hex(raw) {
            return Some(parsed);
        }
    }
    if let Some(raw) = payload
        .get("_smartgate_context")
        .and_then(|c| c.get("prefix_hash"))
        .and_then(|v| v.as_str())
    {
        if let Some(parsed) = parse_prefix_hash_hex(raw) {
            return Some(parsed);
        }
    }
    computed_prefix_hash(payload)
}

fn parse_prefix_hash_hex(raw: &str) -> Option<u64> {
    let s = raw.trim().trim_start_matches("0x");
    if s.len() > 16 {
        u64::from_str_radix(&s[s.len() - 16..], 16).ok()
    } else {
        u64::from_str_radix(s, 16).ok()
    }
}

/// Stable hash of the message prefix (excludes the last message when len > 1).
pub fn computed_prefix_hash(payload: &serde_json::Value) -> Option<u64> {
    let msgs = payload.get("messages")?.as_array()?;
    if msgs.is_empty() {
        return None;
    }
    let prefix = if msgs.len() > 1 {
        &msgs[..msgs.len() - 1]
    } else {
        msgs.as_slice()
    };
    let canonical = serde_json::to_string(prefix).ok()?;
    Some(fnv1a64(canonical.as_bytes()))
}

fn fnv1a64(data: &[u8]) -> u64 {
    const FNV_OFFSET: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x100000001b3;
    let mut hash = FNV_OFFSET;
    for byte in data {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}

fn session_key(pool_id: &str, session_id: &str, epoch: u32) -> SessionKey {
    SessionKey {
        pool_id: pool_id.to_string(),
        session_id: session_id.to_string(),
        epoch,
    }
}

fn purge_stale_sessions() {
    let now = Instant::now();
    SESSIONS.retain(|_, entry| now.duration_since(entry.last_seen) < entry.ttl);
}

fn ttl_from_secs(secs: i32) -> Duration {
    if secs <= 0 {
        DEFAULT_SESSION_TTL
    } else {
        Duration::from_secs(secs as u64)
    }
}

/// Sticky endpoint for an active session epoch, if any.
pub fn get_sticky_endpoint(
    pool_id: &str,
    session_id: &str,
    epoch: u32,
    ttl_secs: i32,
) -> Option<String> {
    purge_stale_sessions();
    let key = session_key(pool_id, session_id, epoch);
    let entry = SESSIONS.get(&key)?;
    if entry.last_seen.elapsed() >= ttl_from_secs(ttl_secs) {
        return None;
    }
    entry.sticky_endpoint_id.clone()
}

/// Assign the next 1-based turn index for this pool + session + epoch.
pub fn next_turn_index(
    pool_id: &str,
    session_id: &str,
    epoch: u32,
    prefix_hash: Option<u64>,
    ttl_secs: i32,
) -> u32 {
    purge_stale_sessions();
    let key = session_key(pool_id, session_id, epoch);
    let ttl = ttl_from_secs(ttl_secs);
    let mut entry = SESSIONS.entry(key).or_insert(SessionEntry {
        turn_count: 0,
        first_prefix_hash: prefix_hash,
        sticky_endpoint_id: None,
        last_seen: Instant::now(),
        ttl,
    });
    entry.turn_count += 1;
    entry.last_seen = Instant::now();
    entry.ttl = ttl;
    if entry.first_prefix_hash.is_none() {
        entry.first_prefix_hash = prefix_hash;
    }
    entry.turn_count
}

/// Whether the current prefix hash matches the first turn in this session epoch.
pub fn prefix_stable(
    pool_id: &str,
    session_id: &str,
    epoch: u32,
    prefix_hash: Option<u64>,
) -> Option<bool> {
    let key = session_key(pool_id, session_id, epoch);
    let entry = SESSIONS.get(&key)?;
    match (entry.first_prefix_hash, prefix_hash) {
        (Some(first), Some(current)) => Some(first == current),
        _ => None,
    }
}

/// After a successful request: bind sticky on first turn; refresh TTL on affinity hit.
pub fn record_success(
    pool_id: &str,
    session_id: &str,
    epoch: u32,
    endpoint_id: &str,
    prefix_hash: Option<u64>,
    affinity_hit: bool,
    ttl_secs: i32,
) {
    let key = session_key(pool_id, session_id, epoch);
    let ttl = ttl_from_secs(ttl_secs);
    let mut entry = SESSIONS.entry(key).or_insert(SessionEntry {
        turn_count: 0,
        first_prefix_hash: prefix_hash,
        sticky_endpoint_id: None,
        last_seen: Instant::now(),
        ttl,
    });
    entry.last_seen = Instant::now();
    entry.ttl = ttl;
    if entry.sticky_endpoint_id.is_none() {
        entry.sticky_endpoint_id = Some(endpoint_id.to_string());
    } else if affinity_hit {
        entry.last_seen = Instant::now();
    }
    if entry.first_prefix_hash.is_none() {
        entry.first_prefix_hash = prefix_hash;
    }
}

pub fn format_prefix_hash(hash: u64) -> String {
    format!("{hash:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_valid_session_id() {
        assert_eq!(
            validate_session_id("cursor-task.abc-123"),
            Some("cursor-task.abc-123".into())
        );
    }

    #[test]
    fn rejects_invalid_session_id() {
        assert!(validate_session_id("").is_none());
        assert!(validate_session_id("has space").is_none());
        assert!(validate_session_id(&"x".repeat(129)).is_none());
    }

    #[test]
    fn epoch_partitions_sessions() {
        let pool = "epoch-test-pool-unique";
        let session = "epoch-test-session-unique";
        assert_eq!(next_turn_index(pool, session, 0, Some(1), 3600), 1);
        assert_eq!(next_turn_index(pool, session, 0, Some(1), 3600), 2);
        assert_eq!(next_turn_index(pool, session, 1, Some(1), 3600), 1);
    }

    #[test]
    fn computed_prefix_hash_excludes_last_message() {
        let body = serde_json::json!({
            "messages": [
                {"role":"user","content":"first"},
                {"role":"assistant","content":"ok"},
                {"role":"user","content":"second"}
            ]
        });
        let h1 = computed_prefix_hash(&body).unwrap();
        let body2 = serde_json::json!({
            "messages": [
                {"role":"user","content":"first"},
                {"role":"assistant","content":"ok"},
                {"role":"user","content":"different"}
            ]
        });
        assert_eq!(h1, computed_prefix_hash(&body2).unwrap());
    }

    #[test]
    fn sticky_binding_on_success() {
        let pool = "sticky-test-pool-unique";
        let session = "sticky-test-session-unique";
        record_success(pool, session, 0, "ep-1", Some(42), false, 3600);
        assert_eq!(
            get_sticky_endpoint(pool, session, 0, 3600),
            Some("ep-1".into())
        );
    }
}
