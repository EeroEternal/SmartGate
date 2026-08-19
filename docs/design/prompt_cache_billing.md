# Prompt Cache Billing & Formatting Design

| | |
|---|---|
| **Status** | Implemented |
| **Topic** | Prompt Cache UI Formatting & Pricing Calibration |
| **Modules** | `src/pricing/`, `src/usage/`, `src/saas/`, `web/src/pages/saas/` |

---

## 1. Background & Challenges

### 1.1 Cache Hit Discount Discrepancy
Modern upstream providers (Anthropic, DeepSeek, OpenAI) offer significant discounts for prompt cache hits (e.g. DeepSeek charges $0.14 / 1M tokens for cache misses, but only $0.014 / 1M tokens for cache hits — a 90% discount).
If an AI gateway computes cost purely based on `prompt_tokens * input_price`, the estimated spend will diverge significantly from the provider's actual bill when prompt caching is heavily utilized.

---

## 2. Design & Implementation

### 2.1 Pricing Engine (`src/pricing/mod.rs`, `src/usage/mod.rs`)

1. **`UnitPrice` Extension**:
   - `cache_read_per_1m: Option<f64>` represents the price per 1M cached prompt tokens.
   - Exact cost formula:
     $$\text{Estimated Cost} = \frac{\text{miss\_tokens}}{10^6} \times P_{\text{input}} + \frac{\text{hit\_tokens}}{10^6} \times P_{\text{cache}} + \frac{\text{completion\_tokens}}{10^6} \times P_{\text{output}}$$
     where:
     - $\text{hit\_tokens} = \min(\text{cache\_hit\_tokens}, \text{prompt\_tokens})$
     - $\text{miss\_tokens} = \text{prompt\_tokens} - \text{hit\_tokens}$
     - If `cache_read_per_1m` is unset, SmartGate defaults to a 90% discount ($0.1 \times P_{\text{input}}$).

2. **Usage Persistence**:
   - `SmartGateHooks::on_request_finished` persists exact token splits (`prompt_tokens`, `completion_tokens`, `cache_read_input_tokens`) and `estimated_cost` to `usage_logs`.

### 2.2 UI Metrics Formatting (`web/src/pages/saas/`)

1. **Compact Large Numbers (`compactTokens`)**:
   - $\ge 1\text{B} \rightarrow \text{x.xxB}$
   - $\ge 1\text{M} \rightarrow \text{x.xxM}$ (e.g. `10,289,024` formatted as `10.29M`)
   - $\ge 10\text{k} \rightarrow \text{x.xk}$
   - Native `toLocaleString()` tooltip on hover to view exact integer values.
2. **Overflow Protection**:
   - Responsive font scaling and text truncation to prevent metric cards from overflowing on narrow viewports.
