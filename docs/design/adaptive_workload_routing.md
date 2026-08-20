# Design Document: Adaptive Workload Profiling & Prior-Guided Routing

## 1. Executive Summary

Traditional AI gateways route requests statelessly: each HTTP request is evaluated in isolation through static heuristic regexes or costly LLM judge classifiers. This approach introduces cold-start latency, wastes tokens on disambiguation, and fails to learn from recurring traffic patterns.

**Adaptive Workload Profiling** elevates SmartGate from a passive proxy to a self-optimizing AI gateway. By continuously aggregating non-sensitive, structural metadata at the API key level, SmartGate constructs a dynamic workload fingerprint (e.g., coding-heavy, tool-orchestrated, or long-context document analysis). This profile acts as a **Bayesian routing prior**, allowing the system to instantly route ambiguous requests to the most cost-effective, high-performing model tier without latency penalties or invasive prompt storage.

---

## 2. Product Framing & Core Principles

### 2.1 Narrative: "Workload Profiling" vs. "User Memory"
SmartGate strictly frames this capability as **Adaptive Workload Profiling**, explicitly avoiding the term "User Memory":
- **API Keys Represent Services, Not Humans**: An API key is frequently shared across background workers, CI/CD runners, VS Code extensions, or multi-agent swarms. It can be rotated or replaced at any time.
- **Enterprise Security & Privacy First**: Enterprise compliance (SOC2, GDPR, HIPAA) forbids storing raw conversational data. Profiling operates purely on derived, aggregated mathematical metrics.

### 2.2 Core Architectural Principles
1. **Zero-Raw-Payload Retention**: Raw user prompts and completions are **never persisted** for profiling. Only discrete task categories, token sizes, tool-use flags, and performance metrics are logged.
2. **Current Request Dominance**: The immediate incoming request's features always dominate the routing decision (70%+ weight). Workload history serves as a Bayesian prior (30% weight) to resolve ambiguity and eliminate unnecessary judge model round-trips.
3. **Exponential Decay (Anti-Overfitting)**: Workload metrics decay exponentially over a 7-day to 14-day half-life. If a developer shifts an API key from code generation to multilingual translation, the gateway adapts within hours.
4. **Strict Authorization Boundaries**: Workload-based optimizations operate **strictly within the API key's authorized Model Services and Endpoints**. The profiler cannot route to endpoints outside the grant scope.
5. **Control Plane / Data Plane Separation**:
   - **SmartGate (Control Plane)**: Aggregates workload statistics, maintains profile representations, and computes prior weights.
   - **UniGateway (Data Plane)**: Extracts neutral request metadata during execution and reports execution feedback asynchronously without blocking the client.

---

## 3. Workload Fingerprint Dimensions

The workload profile for an API key consists of four orthogonal metric dimensions:

| Dimension | Tracked Features & Signals | Routing Impact |
| :--- | :--- | :--- |
| **Task Domain Distribution** | Percentage distribution across: `coding`, `reasoning_math`, `agent_tool_use`, `multilingual_nlp`, `general_chat` | Steers requests toward domain-specialized models (e.g., DeepSeek-Coder vs. generalist LLMs). |
| **Structural Footprint** | `avg_prompt_tokens`, `avg_completion_tokens`, `system_prompt_reuse_rate`, `structured_json_ratio` | Identifies long-context needs and enables cache-affinity routing to maximize prompt cache hits. |
| **Tool & Agent Calling** | `tools_definition_count`, `tools_execution_ratio`, `parallel_tool_call_ratio` | Prefers endpoints with zero-schema-drift tool-calling reliability. |
| **Performance & Cost Tolerance** | `p95_latency`, `client_retry_rate`, `error_rate`, `target_cost_budget` | Avoids slow reasoning models on latency-critical endpoints; prefers Flash models when budget is tight. |

---

## 4. System Architecture

```
[ Client Request ]
       │ (Authorization: Bearer <smartgate-api-key>)
       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ UniGateway (Data Plane)                                                │
│                                                                         │
│  1. Fast Metadata Extraction (Token estimate, tool presence, json mode) │
│  2. Compute Candidate Scores using SmartGate-provided Workload Prior    │
│  3. Execute Upstream Model Call & Stream Normalized Response            │
│  4. Emit Non-blocking Telemetry Event                                  │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ Async Telemetry Stream
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ SmartGate Control Plane (Profile Engine)                                │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ Feature Aggregator & Decay Worker                                 │  │
│  │  - Updates rolling task distributions (7-day half-life)          │  │
│  │  - Computes prompt cache affinity fingerprints                   │  │
│  │  - Stores aggregated profiles in PostgreSQL / Redis Cache         │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ Policy Prior Generator                                            │  │
│  │  - Injects `workload_prior` weights into Virtual Model routes     │  │
│  │  - Generates UI Workload Insights on SaaS Dashboard               │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Routing & Scoring Algorithm

When a request arrives at a Virtual Model service configured with `capability_aware` strategy, the composite endpoint ranking score is formulated as:

$$\text{FinalScore}(ep) = W_{\text{curr}} \cdot S_{\text{current\_match}}(ep) + W_{\text{prior}} \cdot S_{\text{workload\_prior}}(ep) + S_{\text{cost\_perf}}(ep) + S_{\text{health\_penalty}}(ep)$$

Where:
- $S_{\text{current\_match}}(ep) \in [0, 1]$: Immediate match between prompt complexity / keywords / tool definitions and endpoint capabilities.
- $S_{\text{workload\_prior}}(ep) \in [0, 1]$: Historical alignment score based on the key's task domain history.
  $$S_{\text{workload\_prior}}(ep) = \sum_{d \in \text{Domains}} P_{\text{key}}(d) \cdot \text{DNA}_{\text{endpoint}}(d)$$
- $W_{\text{curr}} = 0.70$ and $W_{\text{prior}} = 0.30$ (dynamically scaled down to $0.0$ if the key is in cold-start with $< 10$ requests).
- $S_{\text{cost\_perf}}(ep)$: Bonus for cost-efficiency when budget headroom is constrained.
- $S_{\text{health\_penalty}}(ep)$: Degradation penalty if endpoint latency is surging or rate limits are encountered.

### Fast-Path Judge Elimination
If:
$$\text{Confidence}(S_{\text{current\_match}}) + S_{\text{workload\_prior}} > \theta_{\text{fast\_path}}$$
SmartGate routes immediately to the selected tier (Flash or Pro) **without invoking the Judge model**, cutting routing overhead from ~450ms to <2ms.

---

## 6. Data Storage & Schema Design

### 6.1 PostgreSQL Aggregated Profile Table
```sql
CREATE TABLE saas_api_key_workload_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id UUID NOT NULL REFERENCES saas_api_keys(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES saas_projects(id) ON DELETE CASCADE,
    
    -- Task Domain Probabilities (Sum to 1.0, decayed exponentially)
    pct_coding NUMERIC(4,3) DEFAULT 0.200,
    pct_reasoning NUMERIC(4,3) DEFAULT 0.200,
    pct_tool_use NUMERIC(4,3) DEFAULT 0.200,
    pct_multilingual NUMERIC(4,3) DEFAULT 0.200,
    pct_general_chat NUMERIC(4,3) DEFAULT 0.200,
    
    -- Structural Aggregations
    avg_prompt_tokens INTEGER DEFAULT 0,
    avg_completion_tokens INTEGER DEFAULT 0,
    system_prompt_hash VARCHAR(64),
    system_prompt_reuse_count BIGINT DEFAULT 0,
    
    -- Telemetry & Confidence
    sample_count BIGINT DEFAULT 0,
    last_decayed_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT uq_api_key_profile UNIQUE (api_key_id)
);
CREATE INDEX idx_key_profile_project ON saas_api_key_workload_profiles(project_id);
```

### 6.2 Redis Ephemeral Routing Cache
For sub-millisecond route calculation, SmartGate caches the precomputed prior weights:
`KEY: sg:prior:<api_key_id>` -> JSON payload `{"coding": 0.82, "tools": 0.12, "sample_size": 1420}`.

---

## 7. Implementation Roadmap

### Phase 1: Telemetry & Observability (Read-Only)
- Implement asynchronous request classification metadata extraction in UniGateway.
- Add background exponential-decay aggregation worker in SmartGate backend.
- Introduce a clean **"Workload Pattern"** summary card in the API Key Details UI with hover tooltip annotations.

### Phase 2: Prior-Guided Adaptive Routing
- Incorporate `workload_prior` scoring into the `capability_aware` routing engine.
- Enable Fast-Path routing to eliminate judge model overhead on high-confidence traffic patterns.
- Add user-configurable priority overrides (e.g., "Force Cost-First", "Auto-Adaptive").

### Phase 3: Proactive Model Pool Optimization
- Generate weekly cost-efficiency reports based on detected workload profiles.
- Offer automated recommendations (e.g., *"This key runs 85% coding tasks; binding Qwen 2.5 Coder 32B could reduce costs by 64% with zero quality loss"*).
