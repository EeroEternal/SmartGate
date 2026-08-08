# SmartGate

**Open-source AI gateway — Cost · Control · Choice** on every model call.  
Control plane / data plane separation (UniGateway data plane).

> Legacy name: **ParaGateway**. Scope: [`docs/scope.md`](docs/scope.md) · Roadmap: [`docs/roadmap.md`](docs/roadmap.md)

```text
Agents / IDEs / apps  →  SmartGate (policy, auth, budgets, smart routing)
                              →  UniGateway (protocol & dispatch)
                                  →  upstream models
```

## Why SmartGate

| Pillar | Pain | Approach |
|--------|------|----------|
| **Cost** | Token bills explode | CostAware / CapabilityAware, prices, spend dashboards, progressive budgets |
| **Control** | Keys, limits, runaway spend | Project grants, RPM/concurrency, soft downshift then hard cap |
| **Choice** | Vendor / harness lock-in | Multi-provider pools; stable Virtual Model names; agent-agnostic base URL |

**Pool strategies:** `round_robin`, `priority`, `least_connections`, `latency_based`, `load_aware`, `cost_aware`, `capability_aware`.

**Agents:** first-class **clients** (Cursor, Claude Code, custom agents)—not an agent runtime.  
**MCP:** no MCP hub; agents that use MCP still benefit when **LLM calls** go through SmartGate.  
See [docs/scope.md](docs/scope.md) §4 and [docs/integrations/harness.md](docs/integrations/harness.md).

## Quick start

```bash
# Backend
export ADMIN_TOKEN=admin123
export ADDR=127.0.0.1:18765
export DATABASE_URL='sqlite:smartgate.db?mode=rwc'
cargo run

# Admin UI (another terminal)
cd web && npm install && npm run dev
# http://127.0.0.1:18764
```

Or: `./scripts/start.sh`

API: `POST /v1/chat/completions` (OpenAI-compatible) with a project API key.

## Architecture (short)

| Plane | Responsibility |
|-------|----------------|
| **Control** | Virtual models, pools, keys, strategy scores, quotas, admin UI |
| **Data** | UniGateway — protocol, drivers, streaming, execution reports |

Product objects (Project, VM, Pool) never enter UniGateway core semantics. Provider wire format stays in the data plane.

## Open source vs Enterprise

| | OSS (now) | Enterprise (later) |
|--|-----------|---------------------|
| Multi-provider pools, routing core | Yes | Yes |
| Cost / smart routing, basic budgets | Yes | Enhanced governance |
| SSO, audit export, managed HA/Cloud | — | Yes |

Core routing is not locked behind a paywall.

## Docs

- [Product scope](docs/scope.md)
- [Roadmap](docs/roadmap.md)
- [Harness integration](docs/integrations/harness.md)
- [Technical design](docs/design.md)
- [UniGateway primitives](docs/unigateway_optimization.md)

## License

Apache-2.0 intended for public OSS release (confirm before publish).
