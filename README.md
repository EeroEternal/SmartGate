# SmartGate

Intelligent, cost-optimizing AI gateway for agentic workflows.

SmartGate is an open-source AI gateway designed for the reality of modern multi-turn agent systems. As autonomous agents, coding assistants, and multi-step reasoning swarms become the primary consumers of LLMs, naive API routing breaks down: sending every call to frontier models causes token bills to explode, while indiscriminate load balancing shatters GPU KV cache reuse and spikes latency. SmartGate solves this by making model dispatch intelligent and cache-aware. It scores the complexity of incoming requests in real time, routes everyday tasks to fast economy models while preserving frontier models for complex reasoning, and pins multi-turn sessions to the exact physical instances already holding their KV cache. The result is up to **85%+ cost reduction** with zero loss in task capability.

---

## How it works

SmartGate sits between your agents and upstream LLM providers (cloud APIs or self-hosted inference engines) with a strict separation between control and data planes:

1. **Real-Time Complexity Scoring**: Every incoming prompt is inspected for syntactic complexity, tool schemas, reasoning markers, and context depth to assign a difficulty score ($D \in [0.0, 1.0]$).
2. **Capability-First Dispatch**: Requests with $D \ge 0.55$ automatically route to top-tier reasoning models (Pro tier), while straightforward tasks dispatch to high-speed, cost-effective models (Flash tier).
3. **Session Affinity & Cache Invariants**: Multi-turn sessions (`session_id`) receive an affinity score boost (+10,000) to stick to the same physical node, maximizing KV cache reuse (RadixAttention / Prompt Caching).
4. **Deterministic Context Slimming**: Aged historical tool outputs (`read_file`, `bash`, `grep`) are safely compressed into immutable placeholders, preventing context window bloat while preserving token cache continuity.
5. **Warm Prefix & Delta Delivery**: Static system instructions and repository maps are pre-warmed once, allowing agents to transmit only incremental tail turns.

```text
Agents / IDEs / Apps  →  SmartGate Control Plane (policies, auth, budgets, smart routing)
                               ↓
                         Data Plane (wire protocols, streaming, dispatch)
                               ↓
                         Upstream Models & Inference Engines
```

---

## Features

- **🧠 Intelligent Routing (Pro vs. Flash)**: Real-time difficulty evaluation ($D \in [0, 1]$) routes complex reasoning to Pro models and everyday tasks to Flash, cutting overall token costs by **up to 85%+**.
- **⚡️ Stable Prompt Cache & Session Affinity**: Locks multi-turn sessions to the same physical backend instance (+10,000 Affinity Boost) for maximum KV Cache hit rates and minimal TTFT.
- **📦 Warm Layer & Delta Delivery**: Pre-warms immutable system prompts & repo maps; transmits only incremental tail turns to slash network payloads by **up to 90%**.
- **✂️ Deterministic Context Slimming**: Safely compresses bloated historical tool outputs into deterministic summaries without breaking token cache invariants.
- **🛡️ Progressive Spend Governance**: Real-time project/key limits with 80% soft downshift protection for economy traffic while shielding mission-critical complex tasks.

---

## Quick Start

### Prerequisites
- Rust 1.80+ (Backend)
- Node.js 20+ (Admin UI)
- PostgreSQL 14+

### Local Setup

```bash
# 1. Start the SmartGate server
export ADMIN_TOKEN=change-me
export ADDR=127.0.0.1:18765
export DATABASE_URL='postgres://smartgate:password@127.0.0.1:5432/smartgate'
cargo run

# 2. Start the Admin UI (in another terminal)
cd web
npm install
npm run dev
# Open http://127.0.0.1:18764
```

### Call via OpenAI-compatible Client

Point any OpenAI-compatible SDK, Claude Code, Cursor, or custom agent to SmartGate:

```bash
curl http://127.0.0.1:18765/v1/chat/completions \
  -H "Authorization: Bearer pk_your_api_key" \
  -H "Content-Type: application/json" \
  -H "X-SmartGate-Session-Id: session_my_agent_01" \
  -d '{
    "model": "fusion",
    "messages": [
      {"role": "user", "content": "Explain how distributed consensus works in Raft."}
    ]
  }'
```

---

## Architecture & Boundaries

| Plane | Responsibility |
|---|---|
| **Control Plane** | Organization, Projects, API Keys, Provider Accounts, Virtual Models, Model Pools, Routing Strategy Calculation, Quotas/Budgets, Health Checks, Analytics, and SaaS Admin UI. |
| **Data Plane** | Wire protocols (OpenAI Chat, Responses, Anthropic Messages), Driver execution, SSE Streaming, Fallback mechanisms, and Normalized Usage Reports. |

> **Architectural Invariant**: Business domain objects (Org, Project, Key, Virtual Model) never pollute the data plane. Upstream wire specifics and header conversions stay in the data plane.

---

## Supported Pool Routing Strategies

- `capability_aware` (Intelligent difficulty & capability tiered routing)
- `cost_aware` (Lowest cost / balanced price routing)
- `load_aware` / `latency_based` (Active connection & response latency aware)
- `least_connections` (Least concurrent in-flight requests)
- `priority` (Strict priority and weight ordering)
- `round_robin` (Uniform round-robin distribution)

---

## Documentation

- [Product Scope & Philosophy](docs/scope.md)
- [Architecture & Design](docs/design.md)
- [Session Affinity & Stable Prompt Cache](docs/design/session_and_prompt_cache.md)
- [Intelligent Routing Engine](docs/design/intelligent_routing.md)
- [Harness & Client Integration](docs/integrations/harness.md)
- [Codex Integration Guide](docs/integrations/codex.md)
- [Production Deployment (Railway & Cloudflare)](docs/deployment.md)

---

## License

Apache-2.0. Open-source core with complete multi-provider pooling and intelligent routing capabilities.
