//! Regression tests for CapabilityAware ordering on a Pro + Flash pool.

use std::sync::Arc;

use chrono::Utc;
use dashmap::DashMap;
use unigateway_sdk::core::feedback::RoutingFeedbackProvider;

use crate::models::{EndpointMetric, ModelPool, PoolEndpointMember};
use crate::policy::RouteHint;
use crate::pricing::{EndpointProfile, UnitPrice};
use crate::routing::SmartGateFeedbackProvider;

const POOL: &str = "pool-fusion";
const FLASH: &str = "ep-flash";
const QWEN: &str = "ep-qwen";
const PRO: &str = "ep-pro";

struct Fixture {
    provider: SmartGateFeedbackProvider,
    metrics: Arc<DashMap<String, EndpointMetric>>,
    profiles: Arc<DashMap<String, EndpointProfile>>,
    hints: Arc<DashMap<String, RouteHint>>,
}

fn pool(strategy: &str) -> ModelPool {
    ModelPool {
        id: POOL.to_string(),
        name: "fusion".to_string(),
        strategy: strategy.to_string(),
        enabled: true,
        tool_trim_enabled: 0,
        tool_trim_dry_run: 1,
        max_tool_chars: 4_000,
        session_affinity_enabled: 0,
        session_affinity_ttl_secs: 3_600,
        judge_enabled: 0,
        judge_endpoint_id: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

fn member(endpoint_id: &str) -> PoolEndpointMember {
    PoolEndpointMember {
        endpoint_id: endpoint_id.to_string(),
        priority: 1,
        weight: 1,
    }
}

fn profile(capability: f64, input: f64, output: f64) -> EndpointProfile {
    profile_with_family(capability, capability, input, output)
}

fn profile_with_family(
    capability: f64,
    family_capability: f64,
    input: f64,
    output: f64,
) -> EndpointProfile {
    EndpointProfile {
        price: UnitPrice {
            input_per_1m: input,
            output_per_1m: output,
            cache_read_per_1m: None,
        },
        capability_score: capability,
        family_capability_score: family_capability,
        supports_tools: Some(true),
        context_length: Some(128_000),
    }
}

fn fixture(pro_capability: f64) -> Fixture {
    let pools = Arc::new(DashMap::new());
    pools.insert(POOL.to_string(), pool("capability_aware"));

    let pool_members = Arc::new(DashMap::new());
    pool_members.insert(
        POOL.to_string(),
        vec![member(FLASH), member(QWEN), member(PRO)],
    );

    let profiles = Arc::new(DashMap::new());
    profiles.insert(FLASH.to_string(), profile(0.65, 0.14, 0.28));
    profiles.insert(QWEN.to_string(), profile(0.65, 0.30, 0.60));
    profiles.insert(PRO.to_string(), profile(pro_capability, 2.50, 10.00));

    let metrics = Arc::new(DashMap::new());
    let hints = Arc::new(DashMap::new());

    Fixture {
        provider: SmartGateFeedbackProvider {
            metrics: metrics.clone(),
            pools,
            pool_members,
            profiles: profiles.clone(),
            hints: hints.clone(),
        },
        metrics,
        profiles,
        hints,
    }
}

fn hint(difficulty: f64, has_tools: bool, downshift: bool) -> RouteHint {
    RouteHint {
        input_tokens: 30_000,
        output_tokens: 2_000,
        has_tools,
        difficulty,
        downshift,
        pool_id: POOL.to_string(),
        affinity_enabled: false,
        sticky_endpoint_id: None,
    }
}

/// Endpoint ids ordered exactly the way the UniGateway data plane would try them.
fn attempt_order(fixture: &Fixture) -> Vec<String> {
    let feedback = fixture.provider.feedback(POOL);
    let mut ranked: Vec<(String, bool, f64)> = feedback
        .endpoint_signals
        .iter()
        .map(|(id, signal)| {
            (
                id.clone(),
                signal.excluded || signal.cooldown_until.is_some(),
                signal.score.unwrap_or(f64::NEG_INFINITY),
            )
        })
        .collect();
    ranked.sort_by(|left, right| {
        left.1
            .cmp(&right.1)
            .then_with(|| right.2.total_cmp(&left.2))
            .then_with(|| left.0.cmp(&right.0))
    });
    ranked.into_iter().map(|(id, _, _)| id).collect()
}

#[test]
fn high_difficulty_prefers_pro_when_capability_scores_differ() {
    let fixture = fixture(0.92);
    fixture.hints.insert(POOL.to_string(), hint(1.0, true, false));

    assert_eq!(attempt_order(&fixture).first().map(String::as_str), Some(PRO));
}

#[test]
fn high_difficulty_prefers_pro_when_capability_scores_tie() {
    // Misconfiguration (or a stale capability backfill) can leave Pro and Flash
    // within the top-of-pool tolerance; capability must still outrank price.
    let fixture = fixture(0.66);
    fixture.hints.insert(POOL.to_string(), hint(1.0, true, false));

    assert_eq!(attempt_order(&fixture).first().map(String::as_str), Some(PRO));
}

#[test]
fn budget_downshift_keeps_the_only_capable_endpoint() {
    let fixture = fixture(0.92);
    fixture.hints.insert(POOL.to_string(), hint(1.0, true, true));

    let feedback = fixture.provider.feedback(POOL);
    let pro = feedback.endpoint_signals.get(PRO).expect("pro signal");
    assert!(
        !pro.excluded,
        "budget soft gate must not drop the only capability-qualified endpoint"
    );
    assert_eq!(attempt_order(&fixture).first().map(String::as_str), Some(PRO));
}

#[test]
fn undeclared_tool_support_does_not_exclude_pro() {
    let fixture = fixture(0.92);
    fixture
        .profiles
        .insert(PRO.to_string(), profile(0.92, 2.50, 10.00));
    fixture.hints.insert(POOL.to_string(), hint(1.0, true, false));

    let feedback = fixture.provider.feedback(POOL);
    assert!(!feedback.endpoint_signals.get(PRO).expect("pro signal").excluded);
}

#[test]
fn cooled_down_pro_falls_back_to_flash_and_is_reported() {
    let fixture = fixture(0.92);
    fixture.hints.insert(POOL.to_string(), hint(1.0, true, false));
    let mut metric = EndpointMetric::new(PRO.to_string());
    metric.health_status = "unavailable".to_string();
    metric.cooldown_until = Some(Utc::now() + chrono::Duration::seconds(30));
    metric.total_requests = 3;
    metric.total_errors = 3;
    fixture.metrics.insert(PRO.to_string(), metric);

    let order = attempt_order(&fixture);
    assert_eq!(order.first().map(String::as_str), Some(FLASH));
    assert_eq!(order.last().map(String::as_str), Some(PRO));
}

#[test]
fn identical_configured_scores_are_broken_by_model_family() {
    // Real misconfiguration seen in production: Flash and Pro both carry 0.80, so
    // ranking on the configured score alone leaves price to decide.
    let fixture = fixture(0.92);
    fixture
        .profiles
        .insert(FLASH.to_string(), profile_with_family(0.80, 0.65, 0.14, 0.28));
    fixture
        .profiles
        .insert(QWEN.to_string(), profile_with_family(0.50, 0.65, 0.30, 0.60));
    fixture
        .profiles
        .insert(PRO.to_string(), profile_with_family(0.80, 0.92, 2.50, 10.00));
    fixture.hints.insert(POOL.to_string(), hint(1.0, true, false));

    assert_eq!(attempt_order(&fixture).first().map(String::as_str), Some(PRO));
}

#[test]
fn a_deliberately_higher_configured_score_still_wins() {
    let fixture = fixture(0.92);
    fixture
        .profiles
        .insert(FLASH.to_string(), profile_with_family(0.95, 0.65, 0.14, 0.28));
    fixture
        .profiles
        .insert(PRO.to_string(), profile_with_family(0.80, 0.92, 2.50, 10.00));
    fixture.hints.insert(POOL.to_string(), hint(1.0, true, false));

    assert_eq!(
        attempt_order(&fixture).first().map(String::as_str),
        Some(FLASH)
    );
}

#[tokio::test]
async fn concurrent_easy_request_cannot_downgrade_a_hard_request() {
    let fixture = fixture(0.92);
    // Another in-flight request already published an easy hint on the shared map.
    fixture
        .hints
        .insert(POOL.to_string(), hint(0.15, false, false));

    let order = crate::policy::TASK_ROUTE_HINT
        .scope(hint(1.0, true, false), async { attempt_order(&fixture) })
        .await;

    assert_eq!(order.first().map(String::as_str), Some(PRO));
}

#[test]
fn explain_matches_the_order_the_router_uses() {
    // No shared hint is published: `explain` must score the hint it is handed.
    let fixture = fixture(0.92);
    let candidates = fixture.provider.explain(POOL, hint(1.0, true, false));

    assert_eq!(candidates.len(), 3);
    assert_eq!(candidates[0]["endpoint_id"], PRO);
    assert_eq!(candidates[0]["excluded"], false);
}

#[test]
fn low_difficulty_still_prefers_cheap_flash() {
    let fixture = fixture(0.92);
    fixture
        .hints
        .insert(POOL.to_string(), hint(0.15, false, false));

    assert_eq!(
        attempt_order(&fixture).first().map(String::as_str),
        Some(FLASH)
    );
}
