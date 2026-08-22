# FreeToken Analysis: Lessons for SmartGate and UniGateway

Source: *FreeToken: Efficient Edge-Native MoE Serving with Bandwidth-Adaptive Execution* (Yang et al., arXiv 2608.16157). Code: https://github.com/FlashML-org/FreeToken

This document summarizes the ideas in the paper that are relevant to us, explains
them in plain language, and maps them to concrete opportunities on the SmartGate
control plane and the UniGateway data plane.

---

## 1. What FreeToken is

FreeToken is an inference engine for Mixture-of-Experts (MoE) models on consumer
hardware (a laptop GPU, a gaming desktop). Instead of treating a personal machine
as "a small GPU", it treats it as a heterogeneous platform: GPU VRAM, PCIe
bandwidth, CPU DRAM bandwidth, and CPU compute are all part of one elastic pool.
It co-designs weight loading, expert caching, CPU-GPU execution, and memory
management around two observations:

1. **Agent workloads keep changing their execution pattern** (multi-turn, tool
   calls, context edits), unlike single-shot requests.
2. **Edge hardware is unbalanced**, and the balance differs from machine to
   machine, so no fixed offloading strategy works everywhere.

## 2. The core idea: semantic incremental checkpoints

### 2.1 The problem

Modern frontier models increasingly use hybrid attention: interleaved full
attention plus sliding-window attention, or recurrent layers (e.g. gatedDeltaNet,
Kimi Delta Attention). A recurrent layer compresses the **entire prefix into one
evolving state**. Unlike a KV cache, this state cannot be partially reused: you
either have a checkpoint of the state at token N, or you must recompute everything
from scratch.

Checkpoints are expensive. One saved state costs as much memory as the KV cache
of hundreds of tokens, so an engine can only hold a handful of them. Meanwhile,
agent harnesses edit the conversation history on almost every turn:

- OpenClaw strips thinking blocks from every assistant turn but the latest.
- OpenCode replaces tool outputs beyond a recent window with a fixed placeholder.
- SWE-agent keeps only the last n tool observations.

Any checkpoint taken at a position that was later edited becomes invalid. With
naively placed checkpoints (say, every K tokens), an agent edit invalidates most
of them and forces a full re-prefill of thousands of tokens — tens of seconds of
GPU time on edge hardware.

### 2.2 The insight

**Agent context edits are predictable.** Harnesses do not delete random spans;
they delete whole blocks marked by special tokens: `<think>...</think>`,
`</tool_call>`, `</tool_output>`, conversation turns. After such an edit, the
preserved prefix always ends exactly at one of these semantic boundaries.

So FreeToken places its scarce recurrent-state checkpoints **at those special
token anchors** ("semantic-aware state cache"). When the next request arrives with
an edited prompt, the engine restores from the deepest checkpoint whose anchor
still survives, reuses the full-attention KV up to that point, and re-prefills
only the new suffix.

In one sentence: **predict where the client will cut the context, and pre-place
reusable increments exactly there.**

### 2.3 Why this matters outside of MoE engines

The mechanism itself (recurrent states, expert caches, PCIe budgets) is inference-
engine territory. But the underlying principle generalizes:

> Agentic traffic has structure. The infrastructure that can observe and predict
> that structure — where turns start, what gets trimmed, which prefixes survive —
> can turn that prediction into cost and latency savings.

A gateway sits precisely at the observation point for this structure. That is the
part worth borrowing.

## 3. Relevance to SmartGate (control plane)

SmartGate sees every request's session id, virtual model, endpoint, token usage,
and cache hit counts. Three concrete opportunities follow from the paper's
"agent traffic is predictable" viewpoint.

### 3.1 Cache-aware session affinity (lowest hanging fruit)

Today, session affinity sticks a session to an endpoint blindly. The paper argues
that for agentic sessions, **prefix survival = money and latency saved**: every
cache miss means re-prefilling the whole conversation.

We already log `cache_hit_tokens` and `cache_write_tokens` per request in
`usage_logs`, and we already have session affinity in `model_pools`. What is
missing is closing the loop:

- Aggregate per-session, per-endpoint cache hit rates over a rolling window.
- Feed the rate into routing feedback as a signal: if a sticky endpoint's cache
  hit rate decays (provider evicted our cache), re-rank candidates so the session
  migrates to an endpoint where the next turn is likely to hit.

The data is already collected; only the policy computation is missing.

### 3.2 Cache-price-aware routing for agent sessions

Agent sessions replay long prefixes every turn, so their dominant cost driver is
the **cache read price**, not the nominal input price. SmartGate already stores
`cache_read_per_1m` in endpoint profiles but CostAware scoring uses input price.

For sessions detected as agentic (multi-turn, tool-heavy — signals we compute for
workload profiles today), CostAware should weight cache-read price more heavily.
A provider that charges 10x less for cached tokens may be dramatically cheaper
for agent traffic even at an equal headline input price.

### 3.3 Trim-stability as a first-class metric

If the gateway (or the client harness) edits history between turns, provider-side
prefix caches break at the edit point. SmartGate can measure this: compare
`prompt_tokens` growth against `cache_hit_tokens` across turns of a session. A
session whose cache hit ratio collapses after trims indicates either non-
deterministic trimming (see §4.1) or a provider with aggressive eviction. This is
diagnostic output for both routing feedback and the Quality / Analytics dashboards.

## 4. Relevance to UniGateway (data plane)

Protocol rendering and payload serialization belong to UniGateway. One hard rule
follows directly from the paper.

### 4.1 Deterministic rendering (accepted by UniGateway)

UniGateway parses requests into typed structs and re-serializes the upstream
body, so rendering determinism is a library contract. UniGateway has accepted
this item and the accompanying golden-file regression tests:

- Stable field ordering (serde_json `BTreeMap`, no `preserve_order` needed).
- No rendering decisions dependent on time, counters, or iteration order.
- Golden-file tests that replay a multi-turn sequence and assert the rendered
  bytes of the unchanged history prefix are identical across turns.

Test-design refinements agreed with the UniGateway team:

- **Byte-constancy under repeated rendering, not only cross-turn diff.** Today's
  stability rests on two coincidences: `entry().or_insert()` never overwrites,
  and `serde_json`'s `BTreeMap` sorts keys on output. If `preserve_order` is ever
  enabled (e.g., to pass through client field order), `Map` becomes an
  insertion-ordered IndexMap and the random SipHash iteration order of a fresh
  `HashMap` would leak straight into the bytes. A same-request-rendered-N-times
  case (new struct instance each time → different hash seed) actually exercises
  this; two consecutive turns can coincide in ordering and miss it.
- **All renderers get baselines**, not just OpenAI Chat: `openai/requests.rs`
  (`build_chat_request` and `build_responses_request`, which has its own extra
  merge path), and `anthropic/requests.rs` (extra merge plus conflict-defense
  logic).
- **Injection-position assertions**: system prompt inserted at index 0 of the
  raw-messages path, placeholder thinking signature value — positions where a
  mistake invalidates the upstream cache earlier than necessary.
- **Pinned endpoint context**: fixtures must fix one `DriverEndpointContext`
  because `resolved_model()` rewrites the model name per endpoint; a comment in
  the tests states that fallback-induced cache loss across endpoints is a
  scheduler-layer design property outside this contract.

- Two scope clarifications from the UniGateway team:

- **Determinism holds per (endpoint, model).** A fallback or retry that switches
  endpoints changes the resolved model name anyway, so the upstream cache is lost
  by construction; the rendering layer cannot and should not promise more.
- **Byte-stability is only meaningful on same-protocol passthrough paths.** In a
  cross-protocol conversion (e.g., Anthropic → OpenAI) the provider-native cache
  concepts are not isomorphic to begin with.

The optional neutral message-mutation strategy slot remains parked: revisit only
if SmartGate's trim audit concludes something genuinely belongs in core, at which
point paired-group deletion becomes part of the trait contract.

### 4.2 History editing (trimming) belongs to SmartGate, not UniGateway

An earlier draft of this document assumed tool trimming lived in UniGateway
(`tool_trim_enabled` / `max_tool_chars`). That is incorrect: those switches are
SmartGate control-plane pool settings, and the trimming itself is implemented in
the SmartGate host layer before dispatch (`src/api/proxy.rs`), structurally via
request mutation — which is exactly the layering UniGateway asks for: core stays
policy-free, hosts implement mutations through `hooks.on_request`. The trim
guidelines therefore apply to **SmartGate's own trim implementation**:

- **Delete whole paired groups at message boundaries**, never mid-content. This
  is stronger than "delete whole messages": in OpenAI protocol an assistant
  `tool_calls` message must stay paired with its subsequent `role: "tool"`
  messages; in Anthropic, `tool_use` / `tool_result` are pairs; the Responses API
  chains reasoning items by id. Deleting one side of a pair yields an orphaned
  structure and a provider 4xx. Trim operates on complete pairs/groups only.
- **Replace removed content with a fixed placeholder** (constant text, constant
  shape), not with a variable-length summary.
- **Be deterministic across turns**: given the same history evolution, produce
  byte-identical results. If trim decisions depend on fluctuating state (exact
  char counts near the limit, ordering of equal-priority items), each turn
  produces a different prefix and the upstream provider's prefix cache misses on
  everything after the first divergence.

A well-behaved trim keeps the prefix up to the first edit byte-identical, so the
upstream cache survives until exactly that point — the same "resume from the
surviving anchor" outcome FreeToken achieves with explicit checkpoints.

## 5. What does NOT apply

Expert LRU caches, CPU-GPU execution splitting, double-buffered weight loading,
and q* bandwidth policies are inference-engine mechanics. They sit below the
gateway stack: SmartGate must not encode them in handlers, and UniGateway's job
ends at protocol semantics — it does not manage model residency. Per the project
boundary rules, any future work stays within: SmartGate = policy computation over
observed signals; UniGateway = protocol-level payload stability.

## 6. Suggested next steps

| # | Item | Plane | Effort | Prerequisite |
|---|------|-------|--------|--------------|
| 1 | Cache-hit-rate routing feedback signal for sticky sessions | SmartGate | Low | Data already in `usage_logs` |
| 2 | Cache-read-price weighting in CostAware for agentic sessions | SmartGate | Low | Workload profile detection exists |
| 3 | Session-level cache-collapse diagnostic in Analytics | SmartGate | Medium | Same data |
| 4 | ~~Audit SmartGate trim determinism~~ | SmartGate (host layer) | — | **Done**: content-only trimming shipped (`afd0909`) |
| 5 | ~~Rendering-determinism golden-file regression tests~~ | UniGateway | — | **Done**: released in UniGateway v2.14.2 (commit `31562f6`); also fixed a Responses-path `_`-prefixed field leak. SmartGate consumes 2.14.2. |
