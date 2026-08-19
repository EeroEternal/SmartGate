# Session Affinity & Stable Prompt Cache Architecture

This document details how SmartGate manages `session_id`, builds invariant prompt cache prefixes, enforces physical endpoint affinity, and optimizes multi-turn Agent context delivery.

---

## 1. Overview & Core Motivation

Modern LLM inference engines (e.g., DeepSeek, Claude Prompt Caching, OpenAI, and self-hosted vLLM / SGLang RadixAttention) cache Key-Value (KV) attention blocks using **Longest Common Prefix (LCP)** matching from Token 0.

In multi-turn Agent workflows (e.g., Cursor, Claude Code, Roo Code, Keel, Cline):
1. **Cache thrashing across nodes**: If turn $T_1$ is handled by Node A and turn $T_2$ is load-balanced to Node B, Node B must perform a full prefill from scratch, causing $0\%$ KV cache hits and extreme time-to-first-token (TTFT) latency.
2. **Dynamic tail perturbation**: Appending a new user prompt each turn changes the total request hash, making naive whole-request caching impossible.
3. **Context window bloat**: Accumulated multi-turn tool outputs (`read_file`, `grep`, `bash`) explode token count and evict valuable prefix blocks.

SmartGate solves these challenges through four tightly coupled subsystems:
- **Session Affinity (+10,000 Score Boost)**
- **Prefix / Tail Decoupling & 64-bit FNV-1a Fingerprinting**
- **Zene Warm Layer & Delta Assembly**
- **Deterministic Tool Context Slimming**

```mermaid
flowchart TD
    A[Agent Client] -->|Session ID + Epoch + Prompt| B[SmartGate API Gateway]
    B --> C{Context & Session Inspector}
    
    C -->|Extract Prefix Fingerprint| D[Prefix / Tail Decoupling (FNV-1a)]
    C -->|Lookup Sticky Endpoint| E[Session Affinity Provider]
    C -->|Delta Assembly| F[Zene Warm Snapshot Cache]
    C -->|Age-based Truncation| G[Deterministic Context Slimming]
    
    E -->|Affinity Boost +10,000| H[ScoreOrdered Routing Feedback]
    H -->|Lock to same GPU Node| I[Upstream Inference Node (100% KV Cache Hit)]
```

---

## 2. Session ID Extraction & Protocol Compatibility

SmartGate accepts session identifiers across multiple protocol conventions (evaluated in descending priority order):

| Precedence | Source | Example / Key |
|---|---|---|
| **1 (Highest)** | HTTP Header | `X-SmartGate-Session-Id: session_keel_task_9821` |
| **2** | JSON Body Context | `_smartgate_context.session_id: "session_keel_task_9821"` |
| **3** | OpenAI Compatible Field | `"user": "session_keel_task_9821"` |

### Validation Constraints
- Maximum length: 128 characters.
- Permitted character set: `[a-zA-Z0-9._:-]`.
- Memory storage: Concurrent `DashMap` partitioned by `(pool_id, session_id, epoch)` with configurable TTL (default: 3600 seconds).

---

## 3. Prefix Fingerprint & Invariant Cache Tracking

### Prefix / Tail Decoupling
To verify whether the historical context prefix remains stable without being corrupted by the latest turn's user prompt, SmartGate slices the messages array:

```rust
// src/policy/session.rs
pub fn computed_prefix_hash(payload: &serde_json::Value) -> Option<u64> {
    let msgs = payload.get("messages")?.as_array()?;
    if msgs.is_empty() {
        return None;
    }
    // Slices all messages except the newest user prompt
    let prefix = if msgs.len() > 1 {
        &msgs[..msgs.len() - 1]
    } else {
        msgs.as_slice()
    };
    let canonical = serde_json::to_string(prefix).ok()?;
    Some(fnv1a64(canonical.as_bytes()))
}
```

### Cumulative vs Immutable Fingerprints
1. **Standard Multi-Turn Conversations**:
   - Turn 1: Fingerprint $H_1 = \text{hash}(\text{Msg}_1)$
   - Turn 2: Fingerprint $H_2 = \text{hash}(\text{Msg}_1 + \text{Msg}_2)$
   - Turn 3: Fingerprint $H_3 = \text{hash}(\text{Msg}_1 + \dots + \text{Msg}_4)$
   - Each turn represents the cumulative immutable prefix up to the previous assistant response, aligning with Radix tree expansion on the inference engine.
2. **Warm Static Snapshots**:
   - The base snapshot fingerprint (containing system prompt, repository map, tool declarations) is completely static and constant across all turns.

---

## 4. Session Affinity (Sticky Node Binding)

When a model pool enables session affinity:
1. **Binding on First Turn**: When Turn 1 completes successfully, the selected physical endpoint ID (`sticky_endpoint_id`) is recorded in memory for `(pool_id, session_id, epoch)`.
2. **Affinity Boost Score**: On subsequent turns, the routing feedback provider injects `AFFINITY_BOOST` into the scoring pipeline:
   ```rust
   pub const AFFINITY_BOOST: f64 = 10_000.0;
   
   if affinity_enabled && sticky_is_capable {
       if let Some(signal) = feedback.endpoint_signals.get_mut(&sticky) {
           if !signal.excluded {
               signal.score = Some(signal.score.unwrap_or(0.0) + AFFINITY_BOOST);
           }
       }
   }
   ```
3. **Capability & Health Verification**: The sticky endpoint is only boosted if it remains healthy and meets the required difficulty capability score ($D \ge 0.55$). If the sticky node degrades, the gateway automatically falls back to the next best candidate.

---

## 5. Zene Warm Layer & Delta Assembly

For massive codebases and agent contexts where system instructions exceed tens of thousands of tokens:
1. **Snapshot Publication**: Clients publish the invariant prefix snapshot once via `/v1/warm/publish` (persisted in Redis or in-memory store).
2. **Delta Delivery**: Clients send subsequent chat requests with the header:
   ```http
   X-SmartGate-Context-Delivery: delta
   ```
   The request body contains only the newest tail messages.
3. **Deterministic Assembly**: UniGateway SDK's `DeltaAssemblyMiddleware` intercepts the request, retrieves the snapshot by `(namespace, session_id, epoch)`, and prepends it in byte-deterministic order before dispatching to upstream LLMs.

---

## 6. Deterministic Tool Context Slimming

To prevent multi-turn tool execution logs from evicting prefix cache blocks, `src/policy/context.rs` applies an age-based pruning strategy:

- **Turn Age 0 (Newest Tool Result)**: Retained in full (up to 32,000 characters).
- **Turn Age 1 (Recent Tool Result)**: Truncated to 4,000 characters via `head_tail` (70% head, 30% tail).
- **Turn Age $\ge 2$ (Aged Tool Result)**: Replaced with a deterministic, lightweight placeholder:
  ```text
  src/main.rs ... [omitted by SmartGate: 18450 chars, call_id: call_3821]
  ```

Because identical historical tool executions always produce identical placeholder strings, the token sequence remains invariant and prevents cache invalidation.
