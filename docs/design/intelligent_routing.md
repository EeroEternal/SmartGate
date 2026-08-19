# Intelligent Model Routing & Capability Gating

This document outlines SmartGate's **Capability-Aware Routing (`capability_aware`)** architecture, task complexity scoring system, and two-stage gating model.

---

## 1. Core Architecture: Two-Stage Gating & Pareto Optimization

Rather than naively adding raw monetary cost and capability into a single linear formula, SmartGate uses a **two-stage gating architecture**:

```mermaid
flowchart TD
    Req[Incoming Client Request] --> Diff[Task Intent & Complexity Evaluator]
    Diff --> Gating{Complexity Tier}

    Gating -- High Complexity (D >= 0.60) --> HighPool[Filter for Pro / Reasoning Models: e.g. Pro, R1, Opus]
    Gating -- Low / Medium Task (D < 0.60) --> LowPool[Filter for Cost-Effective Models: e.g. Flash, Mini]

    HighPool --> ScoreHigh[Rank Capable Models by Latency, Load, and Cost]
    LowPool --> ScoreLow[Rank Lightweight Models by Price and Latency]

    ScoreHigh --> Exec[UniGateway Data Plane Dispatch]
    ScoreLow --> Exec
```

### Decision Pipeline
1. **Stage 1 (Capability Hard Gate)**:
   - When request difficulty $D \ge \text{Threshold}$, lightweight models are filtered out from the primary slot, guaranteeing execution on high-capability models (Pro / Reasoning).
   - Simple tasks are routed to lightweight models (Flash / Mini), saving up to 80-90% in inference costs.
2. **Stage 2 (Pareto Ranking & Fallback)**:
   - Within the qualified capability set, candidates are ranked based on active connections (least connections), EMA latency, and unit pricing.
   - If the primary model encounters a rate limit (HTTP 429) or transient error, the gateway seamlessly falls back to the next candidate.

---

## 2. Multi-Tier Complexity Detection System

SmartGate computes a normalized task difficulty $D \in [0.0, 1.0]$ in $< 1\text{ ms}$ using three layers of heuristic signals:

| Tier | Evaluation Signals | Rules & Indicators | Latency |
| :--- | :--- | :--- | :--- |
| **L1: Static Structure** | Token length, code density, schemas | • Prompt tokens $> 6,000$ or multi-file code context<br>• AST snippets, nested SQL schemas, regex, JSON Schema<br>• Multiple tool definitions and dependencies | $< 0.1\text{ ms}$ |
| **L2: Semantic Intent** | Domain concepts & reasoning keywords | • **High ($D \ge 0.60$)**: Formal proofs, distributed consensus (Raft/Paxos), lock-free algorithms, kernel design, quantum computing<br>• **Low ($D < 0.35$)**: Greeting, single-phrase translation, formatting, regex, entity extraction | $< 0.5\text{ ms}$ |
| **L3: Multi-Turn Context** | Conversation depth & feedback cues | • User corrective feedback (e.g. "still failing", "error", "misunderstood")<br>• Tool call execution error traces $\rightarrow$ triggers automatic escalation to Pro models | $< 0.1\text{ ms}$ |

---

## 3. Auxiliary Judge Model (Optional Extension)

For ambiguous prompts where heuristic signals fall into a borderline zone ($0.35 \le D \le 0.65$), administrators can optionally enable an **Auxiliary Judge Model** on the Model Pool:

- **Gated Execution**: Only triggered for borderline queries to minimize latency and token overhead.
- **Micro-Prompt Classification**: Invokes a fast, cheap model (e.g. Flash/Mini) with a single-token binary output (`COMPLEX` vs `SIMPLE`).
- **Circuit Breaker**: Bounded by a strict timeout (default 250ms). If the judge model times out or errors, SmartGate gracefully defaults to the heuristic score without impacting user experience.
