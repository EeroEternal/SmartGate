# Provider, Endpoint, and Model Pool Relationships

This document clarifies the structural boundaries and routing relationships between Provider Accounts, Endpoints, Model Pools, and Model Services in SmartGate.

## Core Hierarchy

SmartGate routes directly at the **Endpoint** level rather than using a two-stage "Provider first, Model second" selection. The gateway models a concrete `Provider Account + upstream_model_id` tuple as an Endpoint, performing candidate selection, scoring, health checks, and fallback directly on Endpoints.

```text
Model Service (Virtual Model)
  -> Model Pool
    -> Endpoint
      -> Provider Account + upstream_model_id
```

- **Provider Type** (e.g. OpenAI, DeepSeek, Anthropic, Aliyun): Metadata identifying the upstream protocol and family; not an independent routing target.
- **Provider Account**: A configured upstream connection containing Base URL, credentials, protocol, and operational status.
- **Endpoint**: The atomic routing unit representing a callable model deployment under a Provider Account.
- **Model Pool**: An administrative container grouping capability-compatible Endpoints and applying a unified routing strategy.
- **Model Service (Virtual Model)**: The stable public model name exposed to client applications, decoupling downstream consumers from upstream provider changes.

## Layer Responsibilities

### Provider Type
Identifies the upstream service family (e.g., `openai`, `anthropic`, `deepseek`, `aliyun`). Used for:
- Protocol adapter selection;
- Admin console categorization;
- Usage aggregation by provider;
- Passing neutral provider hints to UniGateway.

### Provider Account
Represents an authenticated connection instance to an upstream service provider. Contains:
- Base URL
- API Key / credential references
- Protocol type
- Account name and active status

A single Provider Account can host multiple Endpoints:
```text
Provider Account: aliyun-production
  - Endpoint: qwen-plus
  - Endpoint: qwen-turbo
  - Endpoint: qwen-flash
```

### Endpoint
The concrete target of an inference request. Essential attributes:
- Target Provider Account & `upstream_model_id`
- Priority and weight within the pool
- Capability score (0.0 – 1.0)
- Health status and cooldown timer
- Input / Output / Cache-hit pricing per 1M tokens
- Context window length and tool-calling support
- Rolling runtime metrics (EMA latency, active requests, error rate)

The routing engine evaluates and ranks candidate Endpoints (e.g. `endpoint-1` vs `endpoint-2` vs `endpoint-3`), not raw Provider brands.

## Request Lifecycle Example

Suppose an organization exposes a Model Service named `fusion`:

```text
Client request: model = "fusion", prompt = "Analyze Raft log replication"
  │
  ▼
1. Resolve Virtual Model "fusion" -> Model Pool "pool-fusion"
  │
  ▼
2. Fetch active endpoints in "pool-fusion":
   - ep-1: deepseek-prod / deepseek-v4-flash (Cap: 0.65, Cost: $0.14/1M)
   - ep-2: aliyun-prod / qwen-flash        (Cap: 0.65, Cost: $0.15/1M)
   - ep-3: deepseek-prod / deepseek-v4-pro  (Cap: 0.92, Cost: $1.20/1M)
  │
  ▼
3. Evaluate prompt complexity: D = 0.75 (High complexity: distributed consensus)
  │
  ▼
4. Capability-Aware Gating:
   - High task threshold requires Cap >= 0.70
   - Primary candidate: ep-3 (deepseek-v4-pro)
   - Fallback candidates: ep-1, ep-2
  │
  ▼
5. Dispatch via UniGateway:
   - Send to ep-3 upstream URL with ep-3 API credentials
   - If ep-3 fails / rate limits, automatically fallback to next candidate
  │
  ▼
6. Record analytics & spend report
```
