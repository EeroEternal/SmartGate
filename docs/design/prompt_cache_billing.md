# Prompt Cache 计费与展示优化设计

| | |
|---|---|
| **Status** | Implemented (2026-08-16) |
| **Topic** | Prompt Cache UI 格式化 & 缓存折扣计费校准 |
| **Modules** | `src/pricing/`, `src/usage/`, `src/saas/`, `web/src/pages/saas/` |

---

## 1. 背景与问题

### 1.1 UI 溢出问题
在 SaaS 控制台的 Usage（用量统计）页面，Prompt cache 卡片区域采用多列网格布局（`xl:grid-cols-5`）。当缓存命中 Tokens 数量较大（如 `10,289,024`）时，由于数字格式化为完整逗号分隔字符串，且卡片宽度受限，导致末位数字紧贴右侧边框甚至发生视觉截断。

### 1.2 计费与 Provider 账单不一致问题
在 DeepSeek 等支持 Prompt Caching 的模型提供商中：
- **Cache Miss（未命中输入）**：全价计费（如 1.00 元 / 1M tokens）。
- **Cache Hit（命中缓存输入）**：享受极高折扣（如 DeepSeek 为 0.02 元 / 1M tokens，折后仅为原价的 2%）。
- **SmartGate 原计算方式**：直接采用 `prompt_tokens * input_price + completion_tokens * output_price`，将包含 Cache Hit 在内的全部输入 tokens 按未命中的全额输入单价结算。
- **影响**：当 Prompt 缓存命中率达到 95% 时，SmartGate 记录的预估花费与 Provider 实际扣费产生近 10 倍差距。

---

## 2. 优化方案与设计

### 2.1 控制面计费引擎 (`src/pricing/mod.rs`, `src/usage/mod.rs`)

1. **`UnitPrice` 结构扩展**：
   - 增加 `cache_read_per_1m: Option<f64>` 字段，表示每 100 万缓存命中输入 Tokens 的单价。
   - 新增 `calculate_cost(prompt_tokens, completion_tokens, cache_hit_tokens)` 方法：
     $$\text{Estimated Cost} = \frac{\text{miss\_tokens}}{10^6} \times \text{input\_price} + \frac{\text{hit\_tokens}}{10^6} \times \text{cache\_price} + \frac{\text{completion\_tokens}}{10^6} \times \text{output\_price}$$
     其中：
     - $\text{hit\_tokens} = \min(\text{cache\_hit\_tokens}, \text{prompt\_tokens})$
     - $\text{miss\_tokens} = \text{prompt\_tokens} - \text{hit\_tokens}$
     - 若 `cache_read_per_1m` 未显式设置，则默认按 `input_per_1m * 0.1`（即默认 90% 缓存折扣）计算，若未定价则为 0。

2. **请求结算流水记录 (`SmartGateHooks::on_request_finished`)**：
   - 调用 `unit_price.calculate_cost(...)` 写入 `usage_logs.estimated_cost`。

3. **SaaS Catalog 扩展 (`src/saas/mod.rs`)**：
   - `list_model_catalog` 接口同步透出 `eero_llm_providers` 的 `cache_read_price_per_1m` 与 `cache_write_price_per_1m`。

### 2.2 前端展示优化 (`web/src/pages/saas/`)

1. **智能大数紧凑展示 (`compactTokens`)**：
   - $\ge 1\text{B} \rightarrow \text{x.xxB}$
   - $\ge 1\text{M} \rightarrow \text{x.xxM}$（如 `10,289,024` 展示为 `10.29M`）
   - $\ge 10\text{k} \rightarrow \text{x.xk}$
   - 其余保持常规 `toLocaleString()`。
2. **完整数值悬停提示**：
   - 所有卡片组件（`Metric`, `Stat`, `Card`）接收 `fullValue` 并绑定原生 `title` 属性，鼠标悬浮即可查看精确到个位的完整数值。
3. **排版与溢出保护**：
   - 使用 `truncate` 与响应式字体大小（`text-lg sm:text-xl`），确保在不同屏幕和网格列宽下均不溢出。

---

## 3. 测试与验证

- **单元测试**：`src/pricing/mod.rs` 中增加 `test_calculate_cost_with_cache_hit` 与 `test_calculate_cost_default_discount`。
- **端到端校验**：通过 CI 验证，包含 Rust 编译测试与 Web 前端构建打包。
