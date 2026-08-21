# SmartGate Documentation

SmartGate is an open-source AI gateway with control and data plane separation, optimizing model routing, spend governance, and multi-provider resilience.

## Overview & Scope
- **[scope.md](./scope.md)**: Product scope, Cost · Control · Choice pillars, and client integrations.
- **[roadmap.md](./roadmap.md)**: Engineering milestones, active progress, and backlog.
- **[design.md](./design.md)**: System architecture, product hierarchy, and control/data plane boundaries.

## Architecture & Routing
- **[provider-routing.md](./provider-routing.md)**: Relationships between Provider Accounts, Endpoints, Model Pools, and Model Services.
- **[design/intelligent_routing.md](./design/intelligent_routing.md)**: Two-stage capability-aware routing and task complexity detection.
- **[design/router_com_analysis.md](./design/router_com_analysis.md)**: Product and architecture analysis of Router.com (Ramp Router) and takeaways.
- **[design/prompt_cache_billing.md](./design/prompt_cache_billing.md)**: Prompt cache pricing calibration and dashboard metrics formatting.
- **[design/warming.md](./design/warming.md)**: Session affinity, prefix caching, and TTFT warming.
- **[savings_baseline_v2.md](./savings_baseline_v2.md)**: Multi-model cost comparison baseline design.

## Integrations & Deployment
- **[integrations/](./integrations/)**: Client integrations for Cursor, Claude Code, and custom coding agents.
- **[deployment.md](./deployment.md)**: Deployment guides, Railway production setup, and environment variables.
