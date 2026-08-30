# Quota-Aware Cost Routing & Subscription Sunk-Cost Maximization

This document outlines the architecture for **Quota-Aware Cost Routing** in SmartGate, designed to optimize spend across multi-window subscriptions (e.g. 5-hour, 7-day, monthly rolling quotas), free tiers, and pay-as-you-go on-demand endpoints.

---

## 1. Background & Problem Statement

Modern AI model providers employ diverse billing and rate-limiting structures:

1. **Prepaid Subscriptions with Multi-Window Rolling Quotas** (e.g. Allegretto, Claude Team/Pro, Kimi Code, Cursor):
   - Users prepay a flat monthly fee.
   - Usage is regulated by concurrent sliding windows:
     - **Short-term burst window** (e.g. 5-hour rolling usage limit, e.g. 18.21% used, resets at specific timestamp).
     - **Medium-term velocity window** (e.g. 7-day rolling usage limit, e.g. 37.2% used).
     - **Monthly aggregate quota** (e.g. 25.13% used, resets on billing cycle).
   - **Economic characteristic**: *Sunk cost & "Use it or lose it"*. Unused quota within a window cannot be rolled over. If unused, money is wasted; if exhausted prematurely, requests either fail with 429 or overflow into expensive pay-as-you-go extra usage.

2. **Free Tiers & Promotional Quotas** (e.g. Google AI Studio, Groq, OpenRouter `:free`, GitHub Models):
   - Zero marginal cost, but bounded by per-minute (RPM) and per-day (RPD) limits.

3. **On-Demand Pay-As-You-Go** (e.g. DeepSeek API, OpenAI Platform, Anthropic API, OpenRouter paid):
   - Direct marginal cost per token.

### Core Optimization Objective
**Maximize utilization of zero-cost and prepaid (sunk cost) quotas without triggering upstream 429 rate-limit exhaustion, deferring pay-as-you-go token expenditure as late as possible.**

---

## 2. Multi-Tier Quota Architecture

```mermaid
flowchart TD
    Req[Incoming Request] --> Evaluator[SmartGate Route Scoring Engine]
    
    subgraph Tier Hierarchy [Economic Tier Prioritization]
        T0[Tier 0: Free Tier / Zero Marginal Cost]
        T1[Tier 1: Active Subscription Window / Sunk Cost]
        T2[Tier 2: Prompt Cache Optimized Pay-per-token]
        T3[Tier 3: Standard Pay-As-You-Go / Extra Usage]
    end

    Evaluator --> Tier Hierarchy

    subgraph Window Monitor [Dynamic Window Watermark & Urgency]
        W1[5-Hour Rolling Tracker]
        W2[7-Day Rolling Tracker]
        W3[Monthly Quota Tracker]
    end

    Tier Hierarchy --> Window Monitor
    Window Monitor -->|Safe Zone < 80%| ScoreBoost[Boost Tier 1 Score]
    Window Monitor -->|Expiring Soon + Low Usage| UrgencyBoost[Depletion Urgency Boost]
    Window Monitor -->|Critical Zone 80%-95%| SoftThrottle[Soft-Gate: Reserve for High Priority]
    Window Monitor -->|Exhausted >= 95% or 429| Cooldown[Cooldown until Window Reset]

    ScoreBoost --> Dispatch[UniGateway Data Plane Execution]
    UrgencyBoost --> Dispatch
    SoftThrottle -->|Degrade Non-Critical to Tier 2/3| Dispatch
    Cooldown -->|Fallback to Tier 3| Dispatch
```

---

## 3. Tiered Scoring Formulation

In SmartGate's control-plane routing strategies (`cost_aware` and `capability_aware`), endpoint cost estimation is augmented with a **Tier-Adjusted Marginal Cost ($C_{eff}$)**:

$$C_{eff} = C_{base} \times M_{tier} \times M_{watermark} \times M_{urgency}$$

Where:
1. **Marginal Tier Multiplier ($M_{tier}$)**:
   - **Free Tier / Zero Cost**: $M_{tier} = 0.001$ (Effectively free, highest ranking).
   - **Subscription Rolling Window (Active)**: $M_{tier} = 0.01$ (Prepaid sunk cost treated as $99\%$ discounted relative to raw token pricing).
   - **Pay-As-You-Go / On-Demand**: $M_{tier} = 1.0$.

2. **Watermark Penalty Multiplier ($M_{watermark}$)**:
   For a subscription window with utilization $U \in [0.0, 1.0]$:
   - If $U < 0.80$ (Safe zone): $M_{watermark} = 1.0$.
   - If $0.80 \le U < 0.95$ (Conservation zone):
     $$M_{watermark} = 1.0 + 10.0 \times \left(\frac{U - 0.80}{0.15}\right)^2$$
     *(Gradually downshifts non-critical traffic so that interactive / high-complexity queries don't hit hard 429s).*
   - If $U \ge 0.95$ (Exhaustion zone): Endpoint is placed in transient cooldown until $T_{reset}$.

3. **Depletion Urgency Multiplier ($M_{urgency}$)**:
   When a short-term window (e.g. 5-hour) is nearing its reset time $T_{reset}$ (e.g. $\Delta t < 45 \text{ mins}$) and utilization $U < 0.50$:
   $$M_{urgency} = \max\left(0.1, \frac{\Delta t}{T_{window}}\right)$$
   *(Encourages SmartGate to rapidly consume remaining quota before it expires and is lost).*

---

## 4. Multi-Account Pooling & Automatic Rotation

When an organization attaches multiple subscription accounts (e.g., 3 separate developer subscription seats or multiple free tier API keys):

1. **Virtual Pool Aggregation**: All accounts serving compatible models are pooled into the same `ModelPool`.
2. **Dynamic Quota Balancing**:
   - Requests are balanced across accounts proportional to their remaining window headroom:
     $$W_i = \max\left(0, 1.0 - U_i\right)$$
3. **Seamless Failover & Auto-Recovery**:
   - When Account A exhausts its 5-hour window, SmartGate routes to Account B.
   - At Account A's $T_{reset}$, SmartGate automatically re-activates Account A without operator intervention.

---

## 5. Control Plane & Data Plane Separation

Per SmartGate architectural rules:
- **SmartGate (Control Plane)**:
  - Maintains account billing metadata, window definitions, tracked utilization, and quota policies.
  - Computes the routing feedback scores and candidate ordering.
- **UniGateway (Data Plane)**:
  - Dispatches requests to provider endpoints following the score order.
  - Extracts rate-limit headers (`x-ratelimit-remaining`, `retry-after`, `x-ratelimit-reset`) from upstream responses.
  - Reports observed metrics and headers back to SmartGate control plane.
