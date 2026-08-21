//! Auxiliary judge: classifies borderline prompts through UniGateway's normal pipeline.
//!
//! The endpoint is loaded by the control plane, but credentials, provider protocol
//! rendering, timeout enforcement, health hooks, and usage reporting are all owned
//! by UniGateway (data plane).

use std::collections::HashMap;
use std::time::Duration;

use unigateway_sdk::core::{
    Endpoint, LoadBalancingStrategy, ProviderKind, ProviderPool, ProxyChatRequest, RetryPolicy,
};
use unigateway_sdk::host::{HostProtocol, HostRequest};

use crate::config::AppState;
use crate::policy::{
    estimate_tokens_from_text, DIFFICULTY_HIGH_THRESHOLD, DIFFICULTY_MEDIUM_THRESHOLD,
    JUDGE_TIMEOUT_MS,
};

use super::host::SmartGatePoolHost;

const JUDGE_TIMEOUT: Duration = Duration::from_millis(JUDGE_TIMEOUT_MS);
const JUDGE_POOL_PREFIX: &str = "smartgate:judge:";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum DifficultyTier {
    Low,
    Medium,
    High,
}

impl DifficultyTier {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
        }
    }

    pub(super) fn score(self) -> f64 {
        match self {
            Self::Low => 0.20,
            Self::Medium => 0.50,
            Self::High => 0.85,
        }
    }
}

pub(super) fn difficulty_tier(difficulty: f64) -> DifficultyTier {
    if difficulty >= DIFFICULTY_HIGH_THRESHOLD {
        DifficultyTier::High
    } else if difficulty >= DIFFICULTY_MEDIUM_THRESHOLD {
        DifficultyTier::Medium
    } else {
        DifficultyTier::Low
    }
}

/// Classify a borderline request through UniGateway's normal protocol and driver pipeline.
///
/// The endpoint is loaded by the control plane, but credentials, provider protocol rendering,
/// timeout enforcement, health hooks, and usage reporting are all owned by UniGateway.
pub(super) async fn classify_with_judge(
    state: &AppState,
    judge_endpoint_id: &str,
    prompt_text: &str,
    org_id: &str,
    project_id: &str,
    key_id: &str,
    virtual_model_id: &str,
    source_pool_id: &str,
) -> Option<DifficultyTier> {
    let endpoint = crate::sync::load_endpoint_for_dispatch(&state.db, judge_endpoint_id)
        .await
        .ok()??;
    let judge_pool_id = format!("{JUDGE_POOL_PREFIX}{judge_endpoint_id}");
    let (mut request, host_protocol) = build_judge_request(&endpoint, prompt_text)?;
    request.metadata.extend(HashMap::from([
        ("org_id".to_string(), org_id.to_string()),
        ("project_id".to_string(), project_id.to_string()),
        ("key_id".to_string(), key_id.to_string()),
        ("virtual_model_id".to_string(), virtual_model_id.to_string()),
        ("pool_id".to_string(), source_pool_id.to_string()),
        ("routing_strategy".to_string(), "judge".to_string()),
        ("judge_request".to_string(), "1".to_string()),
        // The outer request owns this quota permit; the judge must not release it.
        ("quota_release".to_string(), "0".to_string()),
        (
            "input_tokens_est".to_string(),
            estimate_tokens_from_text(prompt_text).to_string(),
        ),
        ("output_tokens_est".to_string(), "10".to_string()),
    ]));

    let pool = ProviderPool {
        pool_id: judge_pool_id,
        endpoints: vec![endpoint],
        load_balancing: LoadBalancingStrategy::Fallback,
        retry_policy: RetryPolicy {
            max_attempts: 1,
            per_attempt_timeout: Some(JUDGE_TIMEOUT),
            ..RetryPolicy::default()
        },
        metadata: HashMap::new(),
        forward_metadata_as_headers: None,
    };
    let pool_host = SmartGatePoolHost {
        engine: state.engine.as_ref(),
    };
    let host_context = unigateway_sdk::host::HostContext::from_parts(
        state.engine.as_ref(),
        &pool_host,
    );
    let dispatch = tokio::time::timeout(
        JUDGE_TIMEOUT,
        unigateway_sdk::host::dispatch_request(
            &host_context,
            unigateway_sdk::host::HostDispatchTarget::Pool(pool),
            host_protocol,
            None,
            HostRequest::Chat(request),
        ),
    )
    .await
    .ok()?
    .ok()?;
    let response = match dispatch {
        unigateway_sdk::host::HostDispatchOutcome::Response(response) => response,
        _ => return None,
    };
    let (_, body) = response.into_parts();
    let json = match body {
        unigateway_sdk::protocol::ProtocolResponseBody::Json(json) => json,
        unigateway_sdk::protocol::ProtocolResponseBody::ServerSentEvents(_) => return None,
    };
    classify_judge_response(&json)
}

fn build_judge_request(
    endpoint: &Endpoint,
    prompt_text: &str,
) -> Option<(ProxyChatRequest, HostProtocol)> {
    let judge_model = endpoint
        .model_policy
        .default_model
        .clone()
        .unwrap_or_else(|| "smartgate-judge".to_string());
    let preview: String = prompt_text.chars().take(400).collect();
    let payload = serde_json::json!({
        "model": judge_model,
        "max_tokens": 10,
        "temperature": 0.0,
        "stream": false,
        "messages": [
            {
                "role": "system",
                "content": "You are a prompt complexity classifier. Answer ONLY one label: LOW, MEDIUM, or HIGH. Use HIGH for advanced reasoning, proofs, complex architecture or algorithms, or deep debugging. Use MEDIUM for non-trivial implementation, comparison, design, or analysis. Use LOW for simple questions, formatting, translation, or direct extraction."
            },
            { "role": "user", "content": preview }
        ]
    });

    match endpoint.provider_kind {
        ProviderKind::Anthropic => Some((
            unigateway_sdk::protocol::anthropic_payload_to_chat_request(
                &payload,
                "smartgate-judge",
            )
            .ok()?,
            HostProtocol::AnthropicMessages,
        )),
        _ => Some((
            unigateway_sdk::protocol::openai_payload_to_chat_request(
                &payload,
                "smartgate-judge",
            )
            .ok()?,
            HostProtocol::OpenAiChat,
        )),
    }
}

fn classify_judge_response(response: &serde_json::Value) -> Option<DifficultyTier> {
    let content = response
        .get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(serde_json::Value::as_str)
        .or_else(|| {
            response
                .get("content")
                .and_then(serde_json::Value::as_array)
                .and_then(|blocks| {
                    blocks.iter().find_map(|block| {
                        (block.get("type").and_then(serde_json::Value::as_str) == Some("text"))
                            .then(|| block.get("text").and_then(serde_json::Value::as_str))
                            .flatten()
                    })
                })
        })?;
    let upper = content.trim().to_ascii_uppercase();
    if upper == "HIGH" || upper.contains("HIGH") {
        Some(DifficultyTier::High)
    } else if upper == "MEDIUM" || upper.contains("MEDIUM") {
        Some(DifficultyTier::Medium)
    } else if upper == "LOW" || upper.contains("LOW") {
        Some(DifficultyTier::Low)
    } else if upper.contains("COMPLEX") {
        Some(DifficultyTier::High)
    } else if upper.contains("SIMPLE") {
        Some(DifficultyTier::Low)
    } else {
        None
    }
}

#[cfg(test)]
mod judge_tests {
    use super::{
        build_judge_request, classify_judge_response, difficulty_tier, DifficultyTier,
        JUDGE_TIMEOUT,
    };
    use futures_util::future::BoxFuture;
    use serde_json::json;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};
    use unigateway_sdk::core::transport::{
        HttpTransport, TransportRequest, TransportResponse, StreamingTransportResponse,
    };
    use unigateway_sdk::core::{
        Endpoint, EndpointCapabilities, GatewayError, InMemoryDriverRegistry, LoadBalancingStrategy,
        ModelPolicy, ProviderKind, ProviderPool, RetryPolicy, SecretString, UniGatewayEngine,
    };
    use unigateway_sdk::host::{
        dispatch_request, HostContext, HostDispatchOutcome, HostDispatchTarget, HostFuture,
        HostProtocol, HostRequest, PoolHost, PoolLookupOutcome, PoolLookupResult,
    };

    struct TestPoolHost;

    impl PoolHost for TestPoolHost {
        fn pool_for_service<'a>(
            &'a self,
            _service_id: &'a str,
        ) -> HostFuture<'a, PoolLookupResult<PoolLookupOutcome>> {
            Box::pin(async { Ok(PoolLookupOutcome::NotFound) })
        }
    }

    struct FixedResponseTransport {
        response: TransportResponse,
        seen: Arc<Mutex<Vec<TransportRequest>>>,
    }

    impl HttpTransport for FixedResponseTransport {
        fn send(
            &self,
            request: TransportRequest,
        ) -> BoxFuture<'static, Result<TransportResponse, GatewayError>> {
            let response = self.response.clone();
            let seen = self.seen.clone();
            Box::pin(async move {
                seen.lock().expect("transport request lock").push(request);
                Ok(response)
            })
        }

        fn send_stream(
            &self,
            _request: TransportRequest,
        ) -> BoxFuture<'static, Result<StreamingTransportResponse, GatewayError>> {
            Box::pin(async {
                Err(GatewayError::InvalidRequest(
                    "streaming is not used by Judge tests".to_string(),
                ))
            })
        }
    }

    struct BlockingTransport;

    impl HttpTransport for BlockingTransport {
        fn send(
            &self,
            _request: TransportRequest,
        ) -> BoxFuture<'static, Result<TransportResponse, GatewayError>> {
            Box::pin(async { std::future::pending().await })
        }

        fn send_stream(
            &self,
            _request: TransportRequest,
        ) -> BoxFuture<'static, Result<StreamingTransportResponse, GatewayError>> {
            Box::pin(async { std::future::pending().await })
        }
    }

    fn endpoint(provider_kind: ProviderKind) -> Endpoint {
        Endpoint {
            endpoint_id: "judge-endpoint".to_string(),
            provider_name: Some("Judge Provider".to_string()),
            source_endpoint_id: None,
            provider_family: None,
            driver_id: match provider_kind {
                ProviderKind::Anthropic => "anthropic".to_string(),
                _ => "openai-compatible".to_string(),
            },
            base_url: "https://provider.example/v1/".to_string(),
            api_key: SecretString::new("test-key"),
            model_policy: ModelPolicy {
                default_model: Some("judge-model".to_string()),
                model_mapping: HashMap::new(),
            },
            provider_kind,
            enabled: true,
            max_concurrency: None,
            capabilities: EndpointCapabilities::default(),
            metadata: HashMap::new(),
            forward_metadata_as_headers: None,
        }
    }

    fn engine<T: HttpTransport>(transport: Arc<T>) -> UniGatewayEngine {
        let registry = Arc::new(InMemoryDriverRegistry::new());
        registry.register(Arc::new(
            unigateway_sdk::core::protocol::OpenAiCompatibleDriver::new(transport.clone()),
        ));
        registry.register(Arc::new(
            unigateway_sdk::core::protocol::AnthropicDriver::new(transport),
        ));
        UniGatewayEngine::builder()
            .with_driver_registry(registry)
            .build()
            .expect("test UniGateway engine")
    }

    async fn dispatch_judge(
        endpoint: Endpoint,
        request: unigateway_sdk::core::ProxyChatRequest,
        protocol: HostProtocol,
        engine: &UniGatewayEngine,
    ) -> Result<serde_json::Value, unigateway_sdk::host::HostError> {
        let pool = ProviderPool {
            pool_id: "judge-test-pool".to_string(),
            endpoints: vec![endpoint],
            load_balancing: LoadBalancingStrategy::Fallback,
            retry_policy: RetryPolicy {
                max_attempts: 1,
                per_attempt_timeout: Some(JUDGE_TIMEOUT),
                ..RetryPolicy::default()
            },
            metadata: HashMap::new(),
            forward_metadata_as_headers: None,
        };
        engine.upsert_pool(pool.clone()).await.expect("register Judge pool");
        let host = TestPoolHost;
        let context = HostContext::from_parts(engine, &host);
        let outcome = dispatch_request(
            &context,
            HostDispatchTarget::Pool(pool),
            protocol,
            None,
            HostRequest::Chat(request),
        )
        .await?;
        let HostDispatchOutcome::Response(response) = outcome else {
            return Err(unigateway_sdk::host::HostError::CorePoolNotFound(
                "judge-test-pool".to_string(),
            ));
        };
        let (_, body) = response.into_parts();
        match body {
            unigateway_sdk::protocol::ProtocolResponseBody::Json(body) => Ok(body),
            unigateway_sdk::protocol::ProtocolResponseBody::ServerSentEvents(_) => Err(
                unigateway_sdk::host::HostError::CoreInvalidRequest(
                    "Judge test expected a JSON response".to_string(),
                ),
            ),
        }
    }

    fn response_body(value: serde_json::Value) -> TransportResponse {
        TransportResponse {
            status: 200,
            headers: HashMap::new(),
            body: serde_json::to_vec(&value).expect("response JSON"),
        }
    }

    #[tokio::test]
    async fn dispatches_openai_judge_through_unigateway() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let transport = Arc::new(FixedResponseTransport {
            response: response_body(json!({
                "id": "chatcmpl-judge",
                "object": "chat.completion",
                "model": "judge-model",
                "choices": [{"index": 0, "message": {"role": "assistant", "content": "HIGH"}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 20, "completion_tokens": 1, "total_tokens": 21}
            })),
            seen: seen.clone(),
        });
        let engine = engine(transport);
        let endpoint = endpoint(ProviderKind::OpenAiCompatible);
        let (request, protocol) = build_judge_request(&endpoint, "Design a lock-free queue.")
            .expect("OpenAI Judge request");
        let response = dispatch_judge(endpoint, request, protocol, &engine)
            .await
            .expect("OpenAI Judge dispatch");

        assert_eq!(classify_judge_response(&response), Some(DifficultyTier::High));
        let requests = seen.lock().expect("transport request lock");
        assert_eq!(requests.len(), 1);
        let body: serde_json::Value = serde_json::from_slice(
            requests[0].body.as_deref().expect("Judge request body"),
        )
        .expect("Judge request JSON");
        assert_eq!(body["model"], "judge-model");
        assert_eq!(body["messages"][1]["content"], "Design a lock-free queue.");
        assert_eq!(requests[0].method, unigateway_sdk::core::transport::HttpMethod::Post);
    }

    #[tokio::test]
    async fn dispatches_anthropic_judge_and_normalizes_response() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let transport = Arc::new(FixedResponseTransport {
            response: response_body(json!({
                "id": "msg-judge",
                "type": "message",
                "model": "judge-model",
                "content": [{"type": "text", "text": "LOW"}],
                "stop_reason": "end_turn",
                "usage": {"input_tokens": 18, "output_tokens": 1}
            })),
            seen: seen.clone(),
        });
        let engine = engine(transport);
        let endpoint = endpoint(ProviderKind::Anthropic);
        let (request, protocol) = build_judge_request(&endpoint, "Translate hello to Japanese.")
            .expect("Anthropic Judge request");
        let response = dispatch_judge(endpoint, request, protocol, &engine)
            .await
            .expect("Anthropic Judge dispatch");

        assert_eq!(classify_judge_response(&response), Some(DifficultyTier::Low));
        let requests = seen.lock().expect("transport request lock");
        let body: serde_json::Value = serde_json::from_slice(
            requests[0].body.as_deref().expect("Judge request body"),
        )
        .expect("Judge request JSON");
        assert_eq!(body["model"], "judge-model");
        assert!(body["system"].as_str().unwrap_or_default().contains("classifier"));
        assert!(body["messages"]
            .as_array()
            .unwrap_or(&Vec::new())
            .iter()
            .any(|message| message["role"] == "user"));
    }

    #[tokio::test]
    async fn unavailable_judge_driver_is_a_recoverable_failure() {
        let engine = engine(Arc::new(FixedResponseTransport {
            response: response_body(json!({})),
            seen: Arc::new(Mutex::new(Vec::new())),
        }));
        let mut endpoint = endpoint(ProviderKind::OpenAiCompatible);
        endpoint.driver_id = "missing-driver".to_string();
        let (request, protocol) = build_judge_request(&endpoint, "A borderline prompt.")
            .expect("Judge request");
        let result = dispatch_judge(endpoint, request, protocol, &engine).await;
        assert!(result.is_err(), "missing driver must not produce a Judge result");
    }

    #[tokio::test]
    async fn judge_timeout_is_a_recoverable_failure() {
        let engine = engine(Arc::new(BlockingTransport));
        let endpoint = endpoint(ProviderKind::OpenAiCompatible);
        let (request, protocol) = build_judge_request(&endpoint, "A borderline prompt.")
            .expect("Judge request");
        let result = tokio::time::timeout(
            JUDGE_TIMEOUT + std::time::Duration::from_millis(100),
            dispatch_judge(endpoint, request, protocol, &engine),
        )
        .await;
        assert!(result.is_ok(), "UniGateway timeout should be returned to the caller");
        assert!(result.unwrap().is_err(), "Judge timeout must be recoverable");
    }

    #[test]
    fn parses_complex_and_simple_labels_from_unigateway_response() {
        assert_eq!(
            classify_judge_response(&json!({
                "choices": [{"message": {"content": "HIGH"}}]
            })),
            Some(DifficultyTier::High)
        );
        assert_eq!(
            classify_judge_response(&json!({
                "choices": [{"message": {"content": "medium"}}]
            })),
            Some(DifficultyTier::Medium)
        );
    }

    #[test]
    fn parses_anthropic_text_blocks() {
        assert_eq!(
            classify_judge_response(&json!({
                "content": [{"type": "text", "text": "LOW"}]
            })),
            Some(DifficultyTier::Low)
        );
    }

    #[test]
    fn maps_heuristic_scores_to_one_of_three_tiers() {
        assert_eq!(difficulty_tier(0.20), DifficultyTier::Low);
        assert_eq!(difficulty_tier(0.40), DifficultyTier::Medium);
        assert_eq!(difficulty_tier(0.80), DifficultyTier::High);
    }

    #[test]
    fn accepts_legacy_binary_judge_labels() {
        assert_eq!(
            classify_judge_response(&json!({"choices": [{"message": {"content": "COMPLEX"}}]})),
            Some(DifficultyTier::High)
        );
        assert_eq!(
            classify_judge_response(&json!({"choices": [{"message": {"content": "SIMPLE"}}]})),
            Some(DifficultyTier::Low)
        );
    }

    #[test]
    fn ignores_malformed_or_ambiguous_judge_response() {
        assert_eq!(classify_judge_response(&json!({"choices": []})), None);
        assert_eq!(
            classify_judge_response(&json!({
                "choices": [{"message": {"content": "MAYBE"}}]
            })),
            None
        );
    }
}
