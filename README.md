# SmartGate

**Open-source, enterprise-grade AI Gateway — Cost · Control · Choice** on every model call.  
Engineered with strict **Control Plane / Data Plane separation** for multi-model intelligence, session affinity, and cost governance.

> Legacy name: **ParaGateway**. Scope: [`docs/scope.md`](docs/scope.md) · Roadmap: [`docs/roadmap.md`](docs/roadmap.md)

```text
Agents / IDEs / Apps  →  SmartGate Control Plane (policies, auth, budgets, smart routing)
                               ↓
                         Data Plane (wire protocols, streaming, dispatch)
                               ↓
                         Upstream Models & Inference Engines
```

---

## 🚀 Key Highlights

- **🧠 Intelligent Capability Routing (Pro vs. Flash)**: Real-time difficulty scoring ($D \in [0, 1]$) routes complex reasoning to Pro models and everyday tasks to Flash, cutting costs by **up to 85%+**.
- **⚡️ Stable Prompt Cache & Session Affinity**: Locks multi-turn sessions to the same physical GPU instance (+10,000 Affinity Boost) for maximum KV Cache reuse.
- **📦 Warm Layer & Delta Delivery**: Pre-warms immutable system prompts & repo maps; transmits only incremental tail turns to slash payload sizes by **up to 90%**.
- **✂️ Deterministic Context Slimming**: Safely compresses bloated historical tool outputs into deterministic summaries without breaking token cache invariants.
- **🛡️ Progressive Spend Governance**: Real-time token budgeting with 80% soft downshift protection for economy traffic while shielding mission-critical complex tasks.

---

## 🏛️ Architecture & Clean Boundaries

| Plane | Responsibility |
|---|---|
| **Control Plane** | Organization, Projects, API Keys, Provider Accounts, Virtual Models, Model Pools, Routing Strategy Calculation, Quotas/Budgets, Health Checks, Analytics, and SaaS Admin UI. |
| **Data Plane** | Wire protocols (OpenAI Chat, Responses, Anthropic Messages), Driver execution, SSE Streaming, Fallback mechanisms, and Normalized Usage Reports. |

> **Architectural Invariant**: Business domain objects (Org, Project, Key, Virtual Model) never pollute the data plane. Upstream wire specifics and header conversions stay in the data plane.

---

## 🛠️ Supported Pool Routing Strategies

- `capability_aware` (Intelligent difficulty & capability tiered routing)
- `cost_aware` (Lowest cost / balanced price routing)
- `load_aware` / `latency_based` (Active connection & response latency aware)
- `least_connections` (Least concurrent in-flight requests)
- `priority` (Strict priority and weight ordering)
- `round_robin` (Uniform round-robin distribution)

---

## 📦 Quick Start

### Prerequisites
- Rust 1.80+ (Backend)
- Node.js 20+ (Admin UI)
- PostgreSQL 14+

### Local Setup

```bash
# 1. Start backend server
export ADMIN_TOKEN=change-me
export ADDR=127.0.0.1:18765
export DATABASE_URL='postgres://smartgate:password@127.0.0.1:5432/smartgate'
cargo run

# 2. Start Admin UI (in another terminal)
cd web
npm install
npm run dev
# Open http://127.0.0.1:18764
```

### Call via OpenAI-compatible Client

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

For production deployment instructions on Railway and Cloudflare Pages, see [`docs/deployment.md`](docs/deployment.md).

---

## 📚 Documentation Index

- [Product Scope & Philosophy](docs/scope.md)
- [Architecture & Design](docs/design.md)
- [Session Affinity & Stable Prompt Cache](docs/design/session_and_prompt_cache.md)
- [Intelligent Routing Engine](docs/design/intelligent_routing.md)
- [Harness & Client Integration](docs/integrations/harness.md)
- [Codex Integration Guide](docs/integrations/codex.md)

---

## 📄 License

Apache-2.0. Open-source core with complete multi-provider pooling and intelligent routing capabilities.
