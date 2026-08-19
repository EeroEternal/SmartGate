# SmartGate — Roadmap

| | |
|--|--|
| **Scope** | [scope.md](./scope.md) |
| **Updated** | 2026-08-08 |
| **Principle** | Open source first; Enterprise after OSS is useful alone |

---

## Phase overview

| Phase | Name | Status | Outcome |
|-------|------|--------|---------|
| **R0** | Rebrand & foundation | **Done** | SmartGate identity, C/D docs, crate rename, policy/pricing modules |
| **P0** | Save-story MVP | **Done** | Prices, CostAware, spend on usage, stats, packaging |
| **P1** | Full gateway core | **Done** (minor polish open) | LoadAware, CapabilityAware, budgets, decision metadata, Admin strategies |
| **P2** | Efficiency depth | **Partial** | Tool trim + observability + harness docs shipped; cache/prefix deferred |
| **P3** | Enterprise commercial | **Backlog** | SSO, audit, multi-replica, Cloud, support |

```text
R0 ──► P0 ──► P1 ──► P2 (trim/obs done) ──► P2 leftover (cache/prefix)
                              │
                              └──► P3 Enterprise (not OSS-blocking)
```

---

## R0 — Rebrand & foundation ✅

- [x] Product rename SmartGate; crate `smartgate`
- [x] `docs/scope.md`, README, AGENTS.md boundaries
- [x] `policy/`, `pricing/` module homes
- [x] Admin UI brand; `smartgate.db` default

---

## P0 — Save-story MVP ✅

- [x] Endpoint `input_price_per_1m` / `output_price_per_1m`
- [x] Admin API + UI for prices
- [x] In-memory `EndpointProfile` on sync
- [x] Strategy `cost_aware` (tokens via route hint + error penalty)
- [x] `usage_logs.estimated_cost`
- [x] Stats: total spend, spend by key
- [x] `scripts/start.sh` + README quickstart

**Demo path:** two endpoints with different prices → pool `cost_aware` → Virtual Model → client base URL.

---

## P1 — Full gateway core ✅ (polish remaining)

### Done

- [x] `load_aware` / enhanced latency scoring
- [x] Endpoint capability_score, supports_tools, context_length
- [x] `capability_aware` (heuristic difficulty; no embedding)
- [x] Daily spend limits (key + project); soft 80% downshift; hard 100% block
- [x] `routing_strategy` + `routing_decision` JSON on usage_logs
- [x] Admin strategy picker includes cost / capability / load

### Open polish

- [ ] Dedicated Admin “routing decisions” page (data already in DB)
- [ ] Full i18n (`en` / `zh` / `ja` / `ko`) if locale tree is introduced

---

## P2 — Efficiency depth (partial)

### Done

- [x] Per-request `tool_message_chars` / `trimmed_chars`
- [x] Stats aggregates for context bloat
- [x] Pool tool-trim flags (`tool_trim_enabled`, dry-run, `max_tool_chars`)
- [x] Head+tail trim for `role=tool` (default off)
- [x] [integrations/harness.md](./integrations/harness.md)

### Deferred (next efficiency iteration)

- [ ] Neutral prompt-cache policy + UniGateway pass-through
- [ ] Prefix affinity L1 (hash + in-process observations)
- [ ] Optional small-model conversation compaction

Depends on / tracks: [unigateway_optimization.md](./unigateway_optimization.md).

---

## P3 — Enterprise commercial (backlog)

Not required for OSS usefulness. Sell **governance and ops**, not locked routing cores.

- [ ] OIDC / SAML SSO (+ optional SCIM)
- [ ] Audit log export, longer retention policies
- [ ] Department / multi-project budget workflows & approvals
- [ ] Multi-replica control plane + data-plane config sync guide
- [ ] SmartGate Cloud (hosted control plane, optional)
- [ ] Support / SLA packaging

---

## Near-term priority (suggested)

1. Routing decisions Admin page (P1 polish)
2. Prompt cache policy + prefix affinity (P2 leftover)
3. Enterprise SSO / audit when commercial packaging starts (P3)

---

## Non-goals (do not schedule as core)

- Meta-harness / task-level agent dispatch (Omnigent)
- **MCP registry / MCP protocol proxy hub** (agents that *call models* via SmartGate are enough)
- Protocol stack reimplementation (UniGateway)
- Consumer billing marketplace
- Data catalog / lineage platform

## Product narrative (for docs & launch)

Position around **Cost · Control · Choice** (see [scope.md](./scope.md)), inspired by enterprise AI gateway positioning—not a Unity Catalog clone.

---

## Tracking

Update checkboxes here when work lands. Scope changes go to [scope.md](./scope.md) first, then this file.
