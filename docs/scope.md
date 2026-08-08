# SmartGate — Product Scope

| | |
|--|--|
| **Product** | SmartGate |
| **Legacy name** | ParaGateway (git path / history may still use this) |
| **Status** | Canonical |
| **Updated** | 2026-08-08 |
| **Roadmap** | [roadmap.md](./roadmap.md) |
| **Inspiration** | Enterprise AI gateway patterns (e.g. [Unity AI Gateway](https://www.databricks.com/blog/unity-ai-gateway-generally-available)): Cost · Control · Choice — **without** binding to a data catalog platform |

---

## 1. One-liner

**SmartGate** is an **open-source AI gateway** with **control plane / data plane separation**.

It is the **single door** for model traffic in a team or company: **cut spend**, **enforce access and limits**, and **keep choice** of providers and coding tools—without becoming a meta-harness, MCP platform, or consumer billing product.

| Hook (acquisition) | Stay (product) | Scale (architecture) |
|--------------------|----------------|----------------------|
| Lower internal AI $ | Full gateway ops | Control vs data plane |

**Tagline**

- EN: *Open-source AI gateway — cost, control, and choice on every model call.*
- ZH: *开源 AI 网关：每一笔模型调用都可控、可省、可换。*

---

## 2. Product pillars (Cost · Control · Choice)

Aligned with how enterprises describe AI gateways (cost explosion, weak controls, vendor lock-in)—implemented as a **self-hostable request-path gateway**, not a full data+AI OS.

### 2.1 Cost — observability, budgets, smart routing

| Capability | In scope |
|------------|----------|
| Spend visibility | Usage logs; estimated $ when prices set; by key / project / model dimensions |
| Progressive budgets | Soft gate (downshift to cheaper endpoints) → hard daily cap |
| Smart Routing | Request-level: CostAware, CapabilityAware, load/health filters |
| Efficiency extras | **Context slim** (age prior `role=tool` bodies in `messages`; **no session_id**); bloat stats |

**Not required for “Cost”:** natural-language bill analysis, hosted BI suite.

### 2.2 Control — access, limits, runtime policy on the model path

| Capability | In scope |
|------------|----------|
| Access | API keys, project grants to Virtual Models |
| Rate / concurrency | Per key and project |
| Health / exclusion | Cooldown, degraded, feedback exclusion |
| Audit trail (basic) | Usage + routing_decision metadata |
| Guardrails (staged) | OSS: optional simple audit/block later; Enterprise: richer policy packs |

**Control means governing AI *request traffic***, not replacing enterprise data catalogs, DLP platforms, or agent sandboxes.

### 2.3 Choice — multi-model, agent-agnostic, no lock-in

| Capability | In scope |
|------------|----------|
| Multi-provider | Cloud + OSS + OpenAI-compatible endpoints |
| Stable client contract | Virtual Model names; remap pools without client code changes |
| Agent / IDE agnostic | Any client that speaks OpenAI-compatible chat (Cursor, Claude Code, custom agents, scripts) |
| Open Core | Core routing & budgets in OSS; Enterprise sells governance/ops |

Developers keep their harness and tools; SmartGate is the **base URL and policy layer**.

---

## 3. Architecture

```text
Coding agents / IDEs / apps / scripts
        │  OpenAI-compatible HTTP (model calls)
        ▼
┌─────────────────────── SmartGate ───────────────────────┐
│  Control plane                                            │
│  Cost · Control · Choice policy                           │
│  VM/Pool · keys · scores · budgets · admin UI · usage     │
│                         │ feedback / ordered candidates   │
│                         ▼                                 │
│  Data plane (UniGateway)                                  │
│  protocol · drivers · dispatch · stream · reports         │
└───────────────────────┬─────────────────────────────────┘
                        ▼
                 Upstream model APIs
```

| | **Control plane** | **Data plane** |
|--|-------------------|----------------|
| Owns | Product objects, policy intent, scoring, quotas, UI | Protocol, provider wire, execution, SSE |
| Must not | Encode provider-specific request bodies in handlers | Understand Org / Project / Virtual Model |

Physical multi-process split is optional; **responsibility split is mandatory**.

---

## 4. Agents and MCP — do we need support?

Short answer:

| Surface | Need it? | How |
|---------|----------|-----|
| **Agents (coding / custom)** as **clients** | **Yes — first class** | Point base URL + API key + Virtual Model; document integrations |
| **Agent runtime / meta-harness** | **No** | Omnigent, Claude Code, Cursor, etc. |
| **MCP as traffic that becomes model calls** | **Indirectly yes** | When the agent calls SmartGate for LLM inference, Cost/Control already apply |
| **MCP registry / proxy / hub** | **No (not core)** | Separate products; optional thin later |

### 4.1 Agents — yes, as clients only

Enterprise traffic increasingly comes from **coding agents and internal agents**, not only one backend service. Unity AI Gateway’s GA narrative stresses agent sprawl and “one door.”

SmartGate should treat agents as **primary clients**:

- Same OpenAI-compatible path as any app  
- Same keys, grants, smart routing, budgets, usage attribution  
- Docs: Cursor / Claude Code / custom agents ([integrations/harness.md](./integrations/harness.md))

SmartGate does **not**:

- Run agent loops, sandboxes, or session co-drive  
- Choose which harness executes a task (that is meta-harness / Omnigent)

```text
Agent (Claude Code / Cursor / custom)
   →  may use MCP tools locally or elsewhere
   →  LLM calls go through SmartGate   ← our product surface
```

### 4.2 MCP — not a product pillar; don’t block on it

**MCP** (Model Context Protocol) is about **tools/context servers** the agent talks to. That is **not the same hop** as the model API gateway.

| MCP-related idea | Decision |
|------------------|----------|
| “Support agents that use MCP” | **Yes** — zero special code if LLM traffic uses SmartGate |
| MCP server catalog / discovery | **Out of scope** (asset registry, like a mini catalog) |
| Proxy all MCP JSON-RPC through SmartGate | **Out of scope** for core; high complexity, different protocol |
| Meter/govern MCP-induced **token** cost | **In scope already** — via model requests + tool-message bloat stats |
| Allowlist MCP tool names in chat `tools` | **Optional later** (Control polish), not required for MVP story |

**Recommendation:** Do **not** schedule “MCP gateway” as P0/P1.  
Do **document** that agent+MCP stacks are supported when model calls hit SmartGate.  
Revisit a **thin** Control feature (e.g. tool-name allowlist, attribution tags) only if customers demand it after core Cost/Control/Choice is solid.

### 4.3 Comparison to Unity AI Gateway wording

Databricks lists agents, models, MCPs, skills, tools under one governance umbrella **because** they sit on Unity Catalog + a broad AI asset platform.

SmartGate is narrower and should stay honest:

> **We govern the model request path** (and thus agent spend and access).  
> We do **not** become the registry or runtime for MCP/skills/agents.

---

## 5. Feature scope (concrete)

### 5.1 Core gateway

- Multi-provider accounts and endpoints  
- **Virtual Model → Model Pool → Endpoints**  
- API keys, project grants  
- Health, cooldown, ordered dispatch via data plane  
- Admin API + Admin UI  

### 5.2 Smart Routing & Cost

| Strategy | Role |
|----------|------|
| `priority` | Admin order |
| `round_robin` | Even spread |
| `least_connections` | Active load |
| `latency_based` / `load_aware` | Latency + load + errors |
| `cost_aware` | Expected cost (price × tokens × error penalty) |
| `capability_aware` | Capability − difficulty, then cost |

### 5.3 Control & budgets

- RPM / concurrency limits  
- Daily spend limits (soft downshift / hard block)  
- Routing decision metadata on usage rows  

### 5.4 Context slim (gateway slice — no session_id)

Agent multi-turn history already arrives as `messages` each request. SmartGate can slim **without** a session id standard:

| Keep | Slim |
|------|------|
| Latest tool result(s), user goals, assistant conclusions | Older `role=tool` bodies → short placeholders with a clue |
| Message structure / `tool_call_id` | Intermediate oversized tool dumps |

- Default **off**; pool flags `tool_trim_enabled` / dry-run  
- Quality: placeholders retain a short clue; do not delete message nodes  
- Not an agent runtime; does not require MCP integration  


### 5.5 Open Core commercial shape

| | **OSS** | **Enterprise** (later) |
|--|---------|-------------------------|
| Smart routing, cost, basic budgets | Yes | Yes |
| Spend visibility | Yes | Enhanced (dept, export, retention) |
| Agent-as-client docs & OpenAI path | Yes | Same |
| MCP hub / asset catalog | No | No (unless separate product) |
| SSO / SCIM / compliance export | — | Yes |
| Official multi-replica + Cloud | — | Yes |

Preferred public license: **Apache-2.0** (confirm before publish).

---

## 6. Out of scope

| Item | Alternative |
|------|-------------|
| Meta-harness / task-level harness selection | Omnigent, IDE agents |
| Agent runtime, OS sandbox, live co-drive | Agent products |
| MCP registry, MCP proxy hub, skills store | MCP ecosystem / platform tools |
| Data catalog, lineage, lakehouse governance | Customer’s existing data stack |
| Protocol/driver stack reimplementation | UniGateway |
| Consumer payments / plans | Not this product |
| Vector DB / RAG platform | Optional elsewhere |
| Guaranteed “save N%” SLAs | Workload-specific only |

**Omnigent vs SmartGate:** Omnigent chooses **who runs the task**. SmartGate chooses **which model API each inference hits** and enforces **spend and access policy**.

---

## 7. Success criteria

1. **Cost:** Teams see estimated spend and can lower it via Cost/Capability routing + budgets without changing client apps.  
2. **Control:** Keys, grants, limits, and basic audit exist; progressive budgets don’t hard-kill productive users first.  
3. **Choice:** Swap providers/endpoints behind a Virtual Model; coding agents remain free to use preferred harnesses.  
4. **Agents:** Documented, production path for agent/IDE traffic through the same door.  
5. **MCP:** No false promise of MCP platform; no blocker on agents that use MCP tools.  
6. **Boundary:** Protocol bugs → data plane; policy/budget → control plane.  
7. **OSS honesty:** Core Cost/Control/Choice not locked behind Enterprise.

---

## 8. Related docs

| Doc | Role |
|-----|------|
| [roadmap.md](./roadmap.md) | Phases and backlog |
| [integrations/harness.md](./integrations/harness.md) | Agents / IDEs as clients |
| [design.md](./design.md) | Technical design notes |
| [unigateway_optimization.md](./unigateway_optimization.md) | Data-plane primitive asks |
| [plan.md](./plan.md) | Alias → roadmap |
