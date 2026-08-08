# SmartGate Design Document

> Formerly titled ParaGateway. Product scope: [scope.md](./scope.md).

## 1. Introduction
**SmartGate** is a full-featured AI gateway with control/data plane separation, built on **UniGateway** as the data plane. UniGateway handles protocol translation, provider drivers, request execution, response normalization, and streaming; SmartGate owns the product model, access control, routing policy, usage/spend statistics, and Admin UI.

SmartGate absorbs practical enterprise routing ideas from **XRouter** without duplicating the protocol layer. The product shape is an efficiency-oriented AI gateway: model menus, traffic policies, project access, and operational visibility.

Unlike consumer platforms centered on end-user billing, SmartGate focuses on multi-provider access, routing, spend visibility, and governance without embedding payments as a core dependency.

## 2. Core Objectives
- **UniGateway Foundation**: Use `unigateway-sdk` for protocol handling, provider drivers, request execution, streaming, and normalized reports.
- **Model Pool Routing**: Manage routing around Model Pools instead of forcing administrators to operate individual provider instances for every policy.
- **Virtual Model Abstraction**: Expose stable virtual model names to API consumers and allow administrators to remap providers without changing client code.
- **Project-Based Access**: Make API Keys belong to Projects; Projects are granted access to Virtual Models.
- **Routing Strategy Optimization**: Implement Priority, Latency-Based, and Least Connections policies through UniGateway-compatible feedback and endpoint ordering.
- **Token Statistics**: Track token usage by API key, project, virtual model, model pool, endpoint, and provider.
- **Enterprise-Ready Simplicity**: Keep organization and project management available, but provide a default organization/project path for small deployments.

## 3. Architecture Overview

### 3.1 Tech Stack
- **Language**: Rust
- **Framework**: UniGateway SDK (`unigateway-sdk`)
- **HTTP Server**: Axum
- **Database**: SQLite by default, PostgreSQL optional
- **Frontend**: React + Vite for Admin UI

### 3.2 Product Model

ParaGateway's administrative model is centered on Virtual Models and Model Pools.

```text
Org
  -> Project
    -> API Key
    -> Allowed Virtual Models

Virtual Model
  -> Model Pool
    -> Endpoints
      -> Provider Account
        -> Provider Template
```

#### Provider Template
A provider type supported by UniGateway, such as OpenAI, Azure OpenAI, Anthropic, DeepSeek, or other compatible providers. Templates define provider identity and capability metadata, but provider-specific request rendering remains UniGateway's responsibility.

#### Provider Account
A concrete account configuration for a provider template. It stores administrator-managed data such as API key references, base URL, region, and enabled status.

#### Endpoint
A concrete upstream target that can serve one or more model capabilities. Examples include an OpenAI model, an Azure deployment, or a compatible provider endpoint. Endpoint metadata may include priority, weight, health status, cost metadata, and neutral UniGateway hints.

#### Model Pool
The main routing unit managed by administrators. A pool groups endpoints with compatible capability and applies one routing strategy, such as Priority, Latency-Based, or Least Connections.

#### Virtual Model
The stable model name exposed to API consumers. A request using `model: "fast-chat"` can be routed internally to a Model Pool without exposing provider or endpoint details.

#### Org, Project, and API Key
Organizations are optional grouping units for larger deployments. Projects are the primary access boundary. API Keys are issued from Projects and inherit the Project's allowed Virtual Models, quotas, and limits.

### 3.3 Request Flow

```text
Client request
  -> Authenticate API Key
  -> Resolve Project
  -> Authorize requested Virtual Model
  -> Resolve Virtual Model to Model Pool
  -> Select candidate Endpoints
  -> Calculate routing feedback and endpoint order
  -> Dispatch through UniGateway
  -> Persist usage and routing report
```

ParaGateway owns the control-plane decisions before dispatch. UniGateway owns the protocol execution after the candidate endpoints and neutral metadata are prepared.

### 3.4 System Components

#### API Gateway Host
The entry point for all LLM requests. It handles authentication, project resolution, virtual model authorization, model pool resolution, routing feedback preparation, UniGateway dispatch, and usage reporting.

#### Admin API
Provides CRUD operations for provider accounts, endpoints, model pools, virtual models, projects, API keys, quotas, and routing policies.

#### Usage Tracker
Implemented using UniGateway hooks and reports. It captures completed requests, token usage, latency, endpoint identity, provider identity, project identity, and virtual model identity.

#### Strategy Optimizer
Maintains runtime metrics and produces UniGateway-compatible routing feedback.

- **Priority**: Orders endpoints by administrator-defined priority, with deterministic fallback.
- **Latency-Based**: Scores endpoints using moving averages from recent request latency.
- **Least Connections**: Scores endpoints using active request counts.

Lowest-price routing should remain a later extension after cost metadata and pricing rules are stable.

#### Health Manager
Tracks endpoint health based on explicit checks and request failures. It should mark endpoints as degraded or unavailable at the product layer, then exclude or down-rank them before UniGateway dispatch.

### 3.5 ParaGateway vs. UniGateway Boundary

| Responsibility | ParaGateway | UniGateway |
|----------------|-------------|------------|
| **Product Model** | Org, Project, API Key, Provider Account, Endpoint, Model Pool, Virtual Model | No knowledge of ParaGateway business objects |
| **Access Control** | Authentication, project authorization, quotas, model grants | Not responsible for enterprise access policy |
| **Routing Policy** | Compute strategy, feedback scores, endpoint eligibility, endpoint order | Execute dispatch according to supported strategy and feedback |
| **Protocol** | Store and pass neutral metadata or capability hints | Translate protocols, render provider-specific requests, normalize responses |
| **Provider Behavior** | Configure provider accounts and endpoints | Implement provider drivers, headers, request body shape, SSE parsing |
| **Observability** | Persist usage logs, aggregate metrics, display dashboards | Emit hooks and normalized request reports |
| **Health** | Maintain product-level endpoint status and routing exclusion | Surface execution errors and provider-level outcomes |

ParaGateway must not encode provider-specific request-body fields, protocol conversions, or streaming chunk rewriting in API handlers. If a provider requires special request rendering or response parsing, the change belongs in UniGateway unless a temporary compatibility path is explicitly reviewed and marked for migration.

## 4. Implementation Details

### 4.1 Routing Strategy Mapping
ParaGateway will implement a routing feedback provider or equivalent adapter that translates product-level policy into UniGateway-compatible endpoint scores and ordering.

For each request:

```text
Virtual Model
  -> Model Pool
  -> Eligible Endpoints
  -> Runtime Scores
  -> UniGateway Dispatch
```

For advanced strategies, ParaGateway should pass an ordered endpoint set and neutral feedback values to UniGateway. If UniGateway's existing fallback ordering is insufficient for deterministic priority or fair tie-breaking, the dispatch mechanism should be improved in UniGateway rather than hard-coded in ParaGateway handlers.

### 4.2 Access Model
API Keys belong to Projects. Projects are granted access to Virtual Models.

```text
API Key
  -> Project
  -> Project Virtual Model Grants
  -> Virtual Model
  -> Model Pool
```

This avoids direct `API Key -> Endpoint` or `API Key -> Pool` coupling and keeps endpoint changes invisible to API consumers.

### 4.3 Usage Tracking
Usage records should persist both the public-facing model and the resolved upstream target.

Required dimensions:

- API key
- Project
- Organization
- Requested virtual model
- Resolved model pool
- Resolved endpoint
- Provider account
- Prompt tokens
- Completion tokens
- Total tokens
- Latency
- Status
- Error category when failed

### 4.4 Database Schema
Core tables:

- `orgs`: organization metadata.
- `projects`: project metadata and `org_id`.
- `api_keys`: project-bound API keys, status, hash, metadata, limits.
- `provider_templates`: provider type metadata and capability hints.
- `provider_accounts`: provider account configuration, credentials reference, base URL, region, status.
- `endpoints`: concrete upstream targets, provider account binding, model/deployment name, status, metadata.
- `model_pools`: routing unit, strategy, status, default limits.
- `model_pool_endpoints`: endpoint membership, priority, weight, enabled state.
- `virtual_models`: public model names mapped to model pools.
- `project_model_grants`: project-to-virtual-model permissions and optional limits.
- `usage_logs`: request-level usage, latency, routing, and status data.
- `endpoint_metrics`: rolling runtime metrics for latency, active requests, failures, and health.

### 4.5 Admin UX
The Admin UI should optimize for the administrator's actual workflow:

```text
Add Provider Account
  -> Select or create Endpoints
  -> Create Model Pool
  -> Create Virtual Model
  -> Issue Project API Key
```

The dashboard should show Model Pool health, traffic, latency, failures, and token usage. Detailed configuration pages should remain available for Providers, Endpoints, Model Pools, Virtual Models, Projects, API Keys, and Usage.

## 5. Comparison with Existing Systems

| Feature | XRouter | ParaRouter | ParaGateway |
|---------|---------|------------|-------------|
| Focus | Enterprise routing | Consumer platform | Enterprise AI resource control |
| Foundation | Custom gateway | UniGateway | UniGateway |
| Billing | Optional | Core dependency | Not core; usage statistics first |
| Routing Unit | Provider/model routing | UniGateway basic routing | Virtual Model -> Model Pool |
| Access Model | Enterprise-oriented | User/account-oriented | Project API Key with model grants |
| Protocol Layer | Custom | UniGateway | UniGateway |

## 6. Development Roadmap
1. **Phase 1: Foundation**: Set up Rust project, integrate `unigateway-sdk`, and implement basic Axum proxy with API key authentication.
2. **Phase 2: Product Model Persistence**: Implement organizations, projects, API keys, provider accounts, endpoints, model pools, virtual models, and grants.
3. **Phase 3: Routing Strategies**: Implement Priority, Latency-Based, and Least Connections scoring with UniGateway-compatible routing feedback.
4. **Phase 4: Usage and Health**: Persist usage logs, endpoint metrics, health status, and request reports.
5. **Phase 5: Admin UI**: Build dashboard, guided setup, and configuration pages.
6. **Phase 6: Hardening**: Add quotas, concurrency limits, stress testing, PostgreSQL support, and operational refinements.
