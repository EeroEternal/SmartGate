# Session Affinity & Inference Warming Design

| | |
|--|--|
| **Status** | Implemented |
| **Topic** | Session Affinity, Prefix Caching, and TTFT Warming |
| **Modules** | `src/policy/session.rs`, `src/warm/`, `src/routing/` |

---

## 1. Problem & Objectives

In multi-turn coding agent workflows, clients submit the full cumulative conversation history in `messages`. Upstream providers (Anthropic, OpenAI, DeepSeek) leverage **prompt caching** on identical prefix inputs:
- Cache hits on the same physical instance result in **significantly lower TTFT** and **reduced input token costs**.
- Without session affinity, requests from the same agent session scatter across multiple pool endpoints, drastically lowering cache hit rates.

### Objectives
1. **Session Affinity (Warming Routing)**: Route turns from the same agent session to the same sticky endpoint whenever healthy.
2. **Observability**: Measure stickiness rate, TTFT improvements, and prompt cache token savings.
3. **Clean Boundaries**: Maintain affinity state and metrics in the control plane without modifying client prompt payloads.

---

## 2. Concepts

| Term | Meaning |
|------|---------|
| **Session** | A multi-turn agent interaction identified by a client-provided `session_id`. |
| **Turn** | The $N$-th chat completion request within a session. |
| **Prefix Hash** | Stable hash of prior messages used for prefix tracking. |
| **Sticky Endpoint** | The endpoint selected during the session's first turn; subsequent turns prioritize this target. |
| **Affinity Hit** | When turn $N \ge 2$ successfully dispatches to the session's sticky endpoint. |

---

## 3. Client Contract

### Session Identification (by priority)
1. **Header (Recommended)**: `X-SmartGate-Session-Id: <opaque-string>`
2. **OpenAI `user` field**: Supported as a fallback.

```bash
curl -sS https://api.smartgate.run/v1/chat/completions \
  -H "Authorization: Bearer pk_..." \
  -H "X-SmartGate-Session-Id: agent-session-12345" \
  -H "Content-Type: application/json" \
  -d '{"model":"fusion","messages":[...]}'
```

---

## 4. Control Plane Session Store

- **In-Memory Store (L1)**: High-performance `DashMap<(pool_id, session_id), StickyBinding>` with sliding TTL expiry.
- **Distributed Store (L2, Redis-backed)**: Supports multi-replica deployments with cross-node affinity preservation.
- **Fallback Guarantee**: If the sticky endpoint becomes degraded or unavailable, SmartGate automatically fails over to the next capable candidate.
