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

## 🚀 Key Technical Highlights

### 1. Intelligent Capability-First Routing (Pro vs. Flash)
- **Real-Time Difficulty Scorer**: Evaluates prompt complexity ($D \in [0.0, 1.0]$) using token characteristics, semantic reasoning signals, tool call definitions, and context length.
- **Strict Tiered Dispatching**: High-difficulty requests ($D \ge 0.55$) automatically route to top-tier reasoning models (e.g. `deepseek-v4-pro`, `claude-3-5-sonnet`, `gpt-4o`), while simple tasks route to lightweight, cost-effective models (e.g. `deepseek-v4-flash`, `qwen-flash`), delivering up to **85%+ cost savings**.
- **Auxiliary Complexity Judge**: Optional pre-flight evaluation using lightweight judge models on ambiguous boundary queries ($D \in [0.30, 0.65]$).

### 2. Stable Prompt Cache & Session Affinity
- **Multi-Protocol Session Binding**: Seamlessly extracts `session_id` from `X-SmartGate-Session-Id`, `_smartgate_context.session_id`, or standard OpenAI `user` field.
- **Node Affinity (+10,000 Score Boost)**: Locks multi-turn conversations to the exact physical GPU instance holding active KV Cache blocks, turning cache misses into near **100% KV cache hit rates**.
- **Prefix / Tail Decoupling**: Slices immutable historical context from the dynamic newest user prompt to generate 64-bit `FNV-1a` invariant fingerprints.

### 3. Zene Warm Layer & Delta Context Assembly
- **Immutable Prefix Pre-Warming**: Pre-publishes static system prompts, codebase architectures (Repo Maps), and tool schemas to Redis/memory snapshots.
- **Delta-Only Delivery**: Clients only transmit incremental tail turns with `X-SmartGate-Context-Delivery: delta`, reducing network bandwidth and payload sizes by **up to 90%**.

### 4. Deterministic Tool Context Slimming
- **Age-Based Truncation**: Automatically trims bloated historical tool results (`read_file`, `grep`, `bash`) while preserving the most recent turn in full.
- **Deterministic Placeholders**: Formats aged outputs into identical static summaries, keeping the prompt cache prefix invariant across long-running autonomous agent loops.

### 5. Progressive Budget Governance & Safety Gates
- **Tiered Budgeting**: Tracks real-time token spend per project and API Key against daily limits.
- **Soft Downshift Protection**: Automatically transitions non-critical workloads to economy models upon reaching 80% budget threshold without dropping mission-critical complex tasks.

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
