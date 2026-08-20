# API Key Workload Profiles

## Status

Design for the first read-only workload statistics implementation. This feature is a
SmartGate control-plane capability. It does not change API key authorization, does not
select provider credentials, and does not add API key concepts to UniGateway.

## Purpose

An API key workload profile is a time-bounded, confidence-aware aggregation of request
telemetry. It describes how a key is used so SmartGate can later make better routing
policy decisions. It is not a user quality score, a security risk score, or a replacement
for request-level policy.

The first implementation is observational only: it exposes aggregated statistics and
does not affect routing.

## Data boundary

The request association already exists in the current pipeline:

```text
Authorization
  -> AuthContext.api_key.id
  -> request metadata.key_id
  -> RequestReport.metadata
  -> usage_logs.key_id
```

SmartGate owns authentication, API key grants, aggregation, confidence, and routing
policy. UniGateway only executes the request and reports neutral execution telemetry.
UniGateway must not query `api_keys`, interpret API key names, or maintain workload
profiles.

Profiles must never return prompt previews or raw metadata. Aggregations should use
numeric values and bounded categorical distributions only.

## First read-only API

```text
GET /api/saas/api-keys/:id/profile?range=24h|7d|30d|all
```

The endpoint must verify that the key belongs to the current SaaS project. It returns a
profile for the requested time window, with no changes to routing behavior.

The response should contain:

- API key display metadata safe for the project owner (`id`, name, prefix, status).
- `range`, `window_start`, and `last_observed_at`.
- `sample_count` and a confidence state.
- Request volume and success/error counts.
- Average and percentile latency when samples exist.
- Input, output, and total token totals.
- Cost totals plus usage and pricing confidence.
- Difficulty-tier distribution.
- Tool-request and session/affinity rates.
- Fallback and provider distributions.
- Quality evidence fields as unavailable unless independent Judge or explicit feedback
  data exists.

The endpoint must return `cold_start` for zero samples. Historical profile data must
remain available as anonymous telemetry if a key is deleted; the API must not expose a
secret or assume that the deleted key can still be joined to display metadata.

## Metrics and evidence

### Workload signals

- Request count and success/error count.
- Difficulty tiers from the recorded routing decision.
- Input/output/total tokens.
- Tool request rate.
- Session and affinity rates.
- Long-context rate once a stable token bucket is defined.

### Reliability signals

- Success and error rates from the recorded status code.
- Average and p50/p95 latency.
- Fallback rate from the recorded attempt chain.
- Provider distribution.
- TTFT percentiles for streaming traffic when available.

### Cost signals

- Total and average recorded cost.
- Provider-reported versus locally estimated usage counts.
- Configured pricing versus unpriced request counts.

A cost or token metric must retain its source and confidence. Provider-reported usage is
higher confidence than a local estimate; unavailable usage is not converted into a
fabricated value.

### Quality evidence

The profile must not infer quality from HTTP 200, model names, heuristic difficulty, or
absence of an error. Judge agreement, explicit user feedback, and validator outcomes
must be separate evidence fields and remain `null`/`unavailable` when no independent
observation exists.

## Time windows and confidence

The initial API supports fixed windows: 24 hours, 7 days, 30 days, and all time. A
profile is classified using sample count:

| Samples | State | Routing use |
| ---: | --- | --- |
| 0 | `cold_start` | No profile influence |
| 1-19 | `low_confidence` | Observation only |
| 20-99 | `medium_confidence` | Future bounded influence |
| 100+ | `high_confidence` | Future bounded influence |

The first implementation uses SQL aggregation over `usage_logs` and is not a routing
input. A materialized profile table and time decay may be introduced only after the
read-only metrics are validated in production.

## Planned routing integration

When profiles are eventually used by routing, current request features must dominate
historical behavior. Historical values may only provide a bounded neutral adjustment:

```text
effective_difficulty =
    current_request_difficulty * (1 - profile_weight)
  + historical_key_difficulty * profile_weight
```

The profile weight is zero for cold and low confidence data, limited for medium
confidence data, and capped for high confidence data. Profile adjustments must not
override an obvious current high-difficulty request, API key authorization, budget
checks, or endpoint health.

Only neutral workload hints may cross the control/data-plane boundary, for example:

- historical difficulty distribution;
- tool-request rate;
- long-context rate;
- latency sensitivity;
- fallback rate;
- profile confidence and version.

## Implementation sequence

1. Add the read-only profile endpoint using existing `usage_logs.key_id` data.
2. Add aggregation tests for empty, low-sample, failed, fallback, usage-source, and
   quality-evidence cases.
3. Add an observation view to the SaaS UI without changing route selection.
4. Validate metric definitions and confidence behavior with real traffic.
5. Only then add a bounded profile hint to SmartGate routing strategies.
6. Add independent Judge quality evidence separately when a real Judge provider is
   configured.

## Non-goals

- No API key historical profiling inside UniGateway.
- No change to API key grants or authorization semantics.
- No raw prompt retention or prompt-based user profiling.
- No fabricated quality, savings, or baseline metrics.
- No cost governance change in this phase.
- No automatic routing change in the read-only phase.
