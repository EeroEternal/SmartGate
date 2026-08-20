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

## Converged complexity model

Complexity must remain a single routing signal, not a collection of independently
weighted dimensions. SmartGate computes one `difficulty` score in `[0.0, 1.0]` and
maps it to the existing tiers:

| Tier | Score | Meaning |
| --- | ---: | --- |
| `low` | `< 0.35` | Standard model capability is usually sufficient |
| `medium` | `0.35–0.54` | Borderline workload; may require additional evaluation |
| `high` | `>= 0.55` | Stronger reasoning capability is preferred |

The score is a routing heuristic, not an objective task-difficulty truth. Its inputs
remain intentionally small and interpretable: request structure, approximate input
length, code/reasoning signals, conversation depth, and correction cues. These signals
must not become separate profile dimensions or separate route scores.

Three capability requirements remain outside the difficulty score because they are
hard constraints rather than evidence that a task needs stronger reasoning:

- `has_tools`: only tool-capable endpoints may be selected;
- estimated context size: endpoints with insufficient context capacity are excluded;
- structured-output requirements: endpoints that cannot satisfy the requested format
  are excluded or ranked behind compatible endpoints.

The optional Judge model has one responsibility: classify the ambiguous boundary range
(`0.30–0.65`) as `low`, `medium`, or `high`. Clearly simple and clearly complex requests
use the heuristic directly. A successful Judge result becomes the final complexity tier
and is recorded with `difficulty_source = "judge"`; timeout, driver failure, or invalid
output falls back to the heuristic with `difficulty_source = "heuristic"`. The read-only
Profile aggregates this source alongside the tier distribution; absent or unrecognized
source values are conservatively counted as `heuristic`. Judge calls are bounded and
dispatched through UniGateway, but Judge does not select providers,
bypass authorization, change budgets, or produce a quality score.

This keeps the decision path small:

```text
hard capability constraints
  -> heuristic triage
  -> boundary Judge when needed
  -> one difficulty tier
  -> existing SmartGate routing strategy
  -> UniGateway execution
```

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
- Difficulty-tier distribution and `difficulty_sources` (`heuristic` versus `judge`). Missing or invalid source metadata is counted as `heuristic`.
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
- Difficulty tiers from the recorded routing decision, including their source.
- Input/output/total tokens.
- Tool request rate as an observed capability requirement.
- Session and affinity rates.
- Context pressure represented by token totals, not as another difficulty score.

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
absence of an error. The routing Judge is a complexity classifier, not an independent
quality Judge. Judge complexity decisions may be reported as decision-source telemetry,
but they must not populate quality metrics. Independent output evaluation, explicit user
feedback, and validator outcomes must remain separate evidence fields and stay
`null`/`unavailable` when no independent observation exists.

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

The read-only Profile API does not affect routing. If historical workload evidence is
later used, it must remain a weak prior and must not create additional complexity
scores. The current request's single `difficulty` score remains authoritative; a
historical profile may only help resolve a medium-tier boundary when confidence is
sufficient and the adjustment is explicitly bounded.

The preferred first integration is not to rewrite `difficulty`. It is to expose a
neutral, versioned hint to the existing SmartGate policy, such as:

- historical `low`/`medium`/`high` distribution;
- observed tool-request rate as a capability hint;
- observed token-volume bucket;
- profile confidence and version.

The hint must have zero influence for `cold_start` and `low_confidence`, a small capped
influence for `medium_confidence`, and a fixed maximum influence for `high_confidence`.
It must never override current request capability requirements, an obvious current
high-difficulty request, API key authorization, budget checks, or endpoint health.

Latency, fallback, error rate, cost, and provider health remain runtime ranking signals;
they are not complexity dimensions and must not be folded into the historical
difficulty prior.

## Implementation sequence

1. Add the read-only profile endpoint using existing `usage_logs.key_id` data.
2. Add aggregation tests for empty, low-sample, failed, fallback, usage-source, and
   quality-evidence cases.
3. Keep the complexity contract narrow: one score, three tiers, three hard capability
   requirements, and an explicit `heuristic`/`judge` source.
4. Add an observation view to the SaaS UI without changing route selection.
5. Validate tier stability, Judge agreement, fallback behavior, and confidence with real
   traffic before using any profile hint.
6. Only then consider a bounded historical hint for medium-tier decisions.
7. Add independent Judge quality evidence separately when a real output-evaluation
   provider is configured.

## Non-goals

- No API key historical profiling inside UniGateway.
- No change to API key grants or authorization semantics.
- No raw prompt retention or prompt-based user profiling.
- No fabricated quality, savings, or baseline metrics.
- No cost governance change in this phase.
- No automatic routing change in the read-only phase.
- No independent profile dimension for reasoning, context, tools, conversation, output,
  or correction complexity.
- No use of the routing Judge as a quality score or output-quality evaluator.
