# SmartGate Design Document

Product scope: [scope.md](./scope.md).

## 1. Introduction
**SmartGate** is a full-featured AI gateway with control and data plane separation, built on **UniGateway** as the data execution engine. UniGateway handles protocol translation, provider drivers, request execution, response normalization, and streaming; SmartGate owns the product model, access control, routing policy, usage and spend statistics, and the Admin UI.

Unlike consumer platforms centered on end-user billing, SmartGate focuses on multi-provider access, routing, spend visibility, and governance.

## 2. Core Objectives
- **UniGateway Foundation**: Use `unigateway-sdk` for protocol handling, provider drivers, request execution, streaming, and normalized reports.
- **Model Pool Routing**: Manage routing around Model Pools instead of forcing administrators to operate individual provider instances for every policy.
- **Virtual Model Abstraction**: Expose stable virtual model names to API consumers and allow administrators to remap providers without changing client code.
- **Project-Based Access**: Make API Keys belong to Projects; Projects are granted access to Virtual Models.
- **Routing Strategy Optimization**: Implement Priority, Latency-Based, Least Connections, Cost-Aware, and Capability-Aware policies through UniGateway-compatible feedback and endpoint ordering.
- **Token & Spend Statistics**: Track token usage, prompt caching savings, and estimated spend by API key, project, virtual model, model pool, endpoint, and provider.
- **Enterprise-Ready Simplicity**: Keep organization and project management flexible, with a streamlined default organization/project path for fast onboarding.

## 3. Architecture Overview

### 3.1 Tech Stack
- **Language**: Rust
- **Execution Engine**: UniGateway SDK (`unigateway-sdk`)
- **HTTP Server**: Axum
- **Database**: PostgreSQL (production) / SQLite (development)
- **Frontend**: React + TypeScript + Vite + TailwindCSS for Admin UI

### 3.2 Product Model

SmartGate's administrative hierarchy is centered on Virtual Models (Model Services) and Model Pools:

```text
Org
  -> Project
    -> API Key
    -> Allowed Virtual Models (Project Model Grants)

Virtual Model
  -> Model Pool
    -> Endpoints
      -> Provider Account
        -> Provider Template
```

#### Provider Template
A provider type supported by UniGateway, such as OpenAI, Azure OpenAI, Anthropic, DeepSeek, or other compatible providers. Templates define provider identity and capability metadata.

#### Provider Account
A concrete account configuration for a provider template. It stores administrator-managed credentials, base URL, protocol, and status.

#### Endpoint
A concrete upstream target representing a specific model deployment under a Provider Account. Endpoint metadata includes priority, weight, health status, capability score, context length, pricing, and tool support.

#### Model Pool
The core routing container. A pool groups endpoints with compatible capabilities and applies a routing strategy (such as CapabilityAware, Priority, Latency-Based, or Least Connections).

#### Virtual Model (Model Service)
The stable model name exposed to API consumers (e.g. `fast-chat`, `fusion`, `code-agent`). Requests specifying this model name are dynamically resolved and routed across pool endpoints.

#### Org, Project, and API Key
Projects are the primary access boundary. API Keys belong to Projects and inherit the Project's allowed Virtual Models, quotas, and limits.

### 3.3 Request Flow

```text
Client request
  -> Authenticate API Key
  -> Resolve Project
  -> Authorize requested Virtual Model
  -> Resolve Virtual Model to Model Pool
  -> Evaluate task difficulty and match capability signals
  -> Calculate routing feedback and candidate endpoint ordering
  -> Dispatch through UniGateway data plane
  -> Receive normalized response and stream to client
  -> Persist usage, latency, tokens, cost, and routing report
```

SmartGate owns the control-plane decisions before dispatch. UniGateway owns protocol execution and upstream communication after candidates and neutral metadata are prepared.

### 3.4 System Components

#### API Gateway Host
The entry point for all LLM inference requests (`/v1/chat/completions`). Handles authentication, difficulty evaluation, routing candidate calculation, UniGateway dispatch, and usage reporting.

#### Admin API
Provides CRUD operations for provider accounts, endpoints, model pools, virtual models, projects, API keys, quotas, and routing policies.

#### Usage Tracker
Subscribes to UniGateway lifecycle hooks and reports. Records request latency, token counts (prompt, completion, cache hits), estimated cost, and routing traces.

#### Routing Policy Engine
Maintains runtime metrics and generates UniGateway-compatible feedback:
- **Capability-Aware**: Two-stage gating matching request complexity to capable models, then optimizing for cost/latency.
- **Priority**: Orders endpoints by administrator-defined priority with deterministic fallback.
- **Latency-Based / Load-Aware**: Scores endpoints using exponential moving average (EMA) latencies and active connection counts.
- **Least Connections**: Dispatches to endpoints with fewest active in-flight requests.
- **Cost-Aware**: Minimizes expected cost based on token prices and error probabilities.

#### Health Manager & Circuit Breaker
Tracks endpoint health based on explicit probe checks and consecutive error counts. Automatically isolates degraded or unavailable endpoints, cooling them down before probing recovery.

### 3.5 Control Plane vs. Data Plane Boundary

| Responsibility | SmartGate Control Plane | UniGateway Data Plane |
|----------------|-------------------------|-----------------------|
| **Product Model** | Org, Project, API Key, Provider Account, Endpoint, Model Pool, Virtual Model | Unaware of product-layer business objects |
| **Access Control** | Authentication, project authorization, quotas, model grants | Not responsible for enterprise access policy |
| **Routing Policy** | Compute strategy, capability gating, feedback scores, endpoint ordering | Execute dispatch according to ordered candidate list and feedback |
| **Protocol** | Store and pass neutral metadata and capability hints | Translate protocols, render provider requests, normalize responses |
| **Provider Behavior** | Configure provider accounts and endpoints | Implement provider drivers, headers, request formatting, SSE parsing |
| **Observability** | Persist usage logs, aggregate metrics, display dashboards | Emit lifecycle hooks and normalized request reports |
| **Health** | Maintain product-level endpoint status and routing exclusion | Surface execution errors and provider-level outcomes |

SmartGate never encodes provider-specific request-body transformations in API handlers; all protocol and driver adaptations remain encapsulated in UniGateway.

## 4. Usage Tracking & Analytics
Usage records persist both the public-facing model and the resolved upstream target.

Required dimensions:
- API Key & Project ID
- Requested Virtual Model
- Resolved Model Pool & Target Endpoint
- Upstream Provider & Upstream Model
- Prompt Tokens, Completion Tokens, Cache Hit Tokens
- Total Latency & TTFT
- Estimated Cost & Savings vs. Baseline
- Complexity Tier (Low / Medium / High) & Matched Signals
- HTTP Status & Error details when failed

## 5. Development Phases
1. **Foundation**: Axum gateway, UniGateway integration, API key authentication.
2. **Product Model Persistence**: Orgs, projects, API keys, provider accounts, endpoints, model pools, virtual models, and grants.
3. **Smart Routing & Gating**: Capability-aware routing, load-aware tie breaking, latency EMA, and cost optimization.
4. **Observability & Analytics**: Prompt cache savings calculation, usage dashboard, and query inspection.
5. **Admin UI & SaaS Portal**: Multi-tenant console, provider setup, endpoint testing, and real-time metric visualization.
6. **Hardening**: Redis session warming, concurrency throttling, and automated failover.

## 6. UI & Visual Design Principles
- **Text & Label Completeness**: Card titles, badges, and labels must display full recognizable identifiers. Never let long prefixes or narrow containers truncate critical model names.
- **Progressive Disclosure & Hierarchy**: For composite identifiers (e.g. `provider/model-name`), extract and highlight the core model name, while placing provider metadata into compact badges or secondary slots with full tooltip fallbacks.
- **Consistent Control Sizing**: Maintain uniform sizing and alignment across inputs, custom dropdowns (`Select.tsx`), and modal action triggers.
- **Data Display Precision**: Format all float currency values and scores up to 2 decimal places (`.toFixed(2)`) for UI display cards, and up to 4 decimal places without trailing zeros for form inputs and configuration modals to eliminate raw floating point noise (e.g. `3.5999999999999996`).
