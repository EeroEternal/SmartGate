# Session Affinity & Warming 观测设计

| | |
|--|--|
| **Status** | Phase A–D implemented (2026-08-14) |
| **Roadmap** | P2 leftover — [roadmap.md](../roadmap.md) |
| **Depends** | UniGateway TTFT / cache token 透传 |

---

## 1. 问题与目标

Agent 多轮对话每次请求携带完整 `messages` 前缀。上游 Provider（Anthropic、OpenAI 等）对稳定前缀有 **prompt cache**：同一物理 endpoint 上重复前缀 → **TTFT 更低**、**cached input tokens 更便宜**。

当前 SmartGate 路由（round_robin / load_aware 等）**不会**按会话粘到同一 endpoint，多 endpoint pool 下 cache 几乎命不中。

**目标**

1. **Session affinity（warming 路由）**：同一会话的请求尽量落到同一 endpoint。
2. **可观测**：能回答「session id 对 agent 有没有效果」——stickiness、TTFT lift、cache savings。
3. **边界合规**：策略与观测在控制面；协议/cache 字段解析在 UniGateway 数据面。

**非目标**

- 不做 agent runtime / session 存储（messages 仍由客户端每轮上传）。
- 不保证 100% 粘滞（endpoint 不健康时必须 fallback）。
- 单 endpoint pool 不启用 affinity（无收益）。

---

## 2. 概念

| 术语 | 含义 |
|------|------|
| **Session** | 一次 agent 任务的多轮对话，由客户端提供的 `session_id` 标识 |
| **Turn** | 同 session 内第 N 次 chat completion 请求（从 1 起计） |
| **Prefix hash** | 当前请求 `messages` 前缀的稳定 hash（用于无 session_id 时的 L1 观测与备选粘滞） |
| **Sticky endpoint** | session 首次成功请求选中的 endpoint，后续 turn 优先路由到此 |
| **Affinity hit** | 本 turn 实际 endpoint == sticky endpoint |
| **Warming lift** | turn ≥ 2 相对 turn 1 的 TTFT / latency 改善（有 affinity vs 无 affinity） |

---

## 3. 客户端契约

### 3.1 Session ID 来源（优先级从高到低）

1. **Header（推荐）**：`X-SmartGate-Session-Id: <opaque-string>`
2. **OpenAI `user` 字段**：部分 SDK 已支持，作为 fallback
3. **无 session_id**：仅记录 prefix_hash，不启用 stickiness（仍可统计 bloat / latency）

约束：

- 长度 1–128，字符集 `[A-Za-z0-9._:-]`
- 同一 agent 任务内保持不变；新任务应换新 id
- **不由网关生成**（避免伪造 session 语义）

### 3.2 Harness 集成示例

```bash
curl -sS http://127.0.0.1:18765/v1/chat/completions \
  -H "Authorization: Bearer sk-..." \
  -H "X-SmartGate-Session-Id: cursor-task-abc123" \
  -H "Content-Type: application/json" \
  -d '{"model":"agent-chat","messages":[...]}'
```

文档更新：[integrations/harness.md](../integrations/harness.md) 增加 warming 段落。

---

## 4. 控制面：Session Affinity 路由

### 4.1 Pool 配置

`model_pools` 新增字段：

| 列 | 类型 | 默认 | 说明 |
|----|------|------|------|
| `session_affinity_enabled` | INTEGER | 1 | 是否启用 session stickiness（默认开） |
| `session_affinity_ttl_secs` | INTEGER | 3600 | 无活动后 binding 过期时间 |

Admin UI：Pool 编辑页增加开关 + TTL（仅多 endpoint pool 时展示提示）。

### 4.2 内存 Session Store（L1）

```text
Key:   (pool_id, session_id)
Value: StickyBinding {
         endpoint_id,
         turn_count,      // 已成功完成的 turn 数
         prefix_hash,     // 首 turn 的 hash
         last_seen: Instant,
       }
```

- 进程内 `DashMap`，与现有 `metrics` / `pools` 同级
- TTL 滑动刷新；过期 entry 惰性删除
- **不写 DB**（P2 范围；多副本一致性留 P3）

### 4.3 Prefix hash 算法

```rust
// 伪代码 — 稳定、廉价、与 provider cache 语义近似
fn prefix_hash(messages: &[Message]) -> u64 {
    // 去掉最后一条 user message（当前 turn 的新增部分）
    let prefix = messages[..messages.len().saturating_sub(1)];
    fnv1a64(canonical_json(prefix))  // role+content 顺序敏感
}
```

用途：

- 无 session_id 时写入观测字段
- turn ≥ 2 可对比 `prefix_hash` 是否与上 turn 一致（cache 理论可命中）

### 4.4 与现有 Feedback 集成

扩展 `RouteHint`：

```rust
pub struct RouteHint {
    // ... existing ...
    pub session_id: Option<String>,
    pub prefix_hash: Option<u64>,
    pub turn_index: u32,           // 本请求在 session 内序号（store 递增）
}
```

在 `SmartGateFeedbackProvider::feedback` 中，当 `session_affinity_enabled && session_id`：

1. 查 `StickyBinding`
2. 若 binding 存在且 endpoint **未 excluded**（健康、非 cooldown、tools 兼容）：
   - 对该 endpoint `score += AFFINITY_BOOST`（如 `+1_000_000`，确保 ScoreOrdered 下优先）
   - 记录 `affinity_applied = true`
3. 若 binding 不存在或 sticky 不可用：
   - 正常策略打分；首 turn 成功后写入 binding

**AFFINITY_BOOST 仅在 stickiness 场景叠加**，不改变 cost_aware / capability_aware 的相对排序（除 sticky endpoint 外）。

### 4.4.1 请求完成后更新 Store

`on_request_finished` hook（成功时）：

- `turn_count += 1`
- 首 turn：写入 `endpoint_id` + `prefix_hash`
- 更新 `last_seen`

失败 / fallback 到其他 endpoint：**不**更新 sticky（避免错误 binding）；记录 `affinity_hit = false`。

### 4.5 routing_decision 扩展

现有 JSON 增加 `warming` 块：

```json
{
  "product": "smartgate",
  "strategy": "load_aware",
  "warming": {
    "session_id": "cursor-task-abc123",
    "turn_index": 3,
    "prefix_hash": "a1b2c3d4",
    "affinity_enabled": true,
    "affinity_applied": true,
    "affinity_hit": true,
    "sticky_endpoint_id": "ep-azure-1",
    "selected_endpoint_id": "ep-azure-1",
    "prefix_stable": true
  }
}
```

`prefix_stable`：本 turn 的 prefix_hash 与 session 首 turn 一致（turn≥2 时有意义）。

---

## 5. 数据面：UniGateway 透传

SmartGate **不**解析 provider 特有 cache 字段；由 UniGateway 归一化后写入 `RequestReport`。

### 5.1 Report 字段（UniGateway 侧需求）

| 字段 | 来源示例 | 说明 |
|------|----------|------|
| `ttft_ms` | 流式首 chunk 时间 | 已有规划 [unigateway_optimization.md](../unigateway_optimization.md) §4 |
| `cached_input_tokens` | OpenAI `usage.prompt_tokens_details.cached_tokens`；Anthropic `usage.cache_read_input_tokens` | 归一化为单一整数 |
| `cache_creation_input_tokens` | Anthropic cache write | 可选，用于区分「写 cache」vs「读 cache」 |

写入 `report.metadata` 或 `report.usage` 扩展，SmartGate hooks 只读中立字段。

---

## 6. 落库：`usage_logs` 扩展

### 6.1 Migration

```sql
ALTER TABLE usage_logs ADD COLUMN session_id TEXT;
ALTER TABLE usage_logs ADD COLUMN turn_index INTEGER;
ALTER TABLE usage_logs ADD COLUMN ttft_ms INTEGER;
ALTER TABLE usage_logs ADD COLUMN cached_input_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usage_logs ADD COLUMN affinity_applied INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usage_logs ADD COLUMN affinity_hit INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usage_logs ADD COLUMN prefix_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_usage_logs_session ON usage_logs(session_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_usage_logs_pool_turn ON usage_logs(pool_id, turn_index);
```

`metadata` JSON 仍保留完整 `warming` 块（与 `routing_decision` 冗余可接受，便于 ad-hoc 查询）。

### 6.2 SmartGateHooks 写入

`on_request_finished` 从 `report.metadata` 读取：

- `session_id`, `turn_index`, `prefix_hash`
- `affinity_applied`, `affinity_hit`（bool → 0/1）
- `ttft_ms`, `cached_input_tokens`

---

## 7. 统计 API

### 7.1 `GET /api/admin/stats/warming`

查询参数：`pool_id?`, `since?`（ISO8601，默认 7d）

响应：

```json
{
  "success": true,
  "data": {
    "window": { "since": "...", "until": "..." },
    "sessions_with_id": 120,
    "requests_with_session": 1840,
    "affinity": {
      "enabled_requests": 900,
      "applied_rate": 0.92,
      "hit_rate": 0.87
    },
    "latency": {
      "turn1_avg_ms": 820,
      "turn2plus_avg_ms": 410,
      "turn2plus_avg_ttft_ms": 180,
      "lift_pct": 50.0
    },
    "cache": {
      "requests_with_cached_tokens": 640,
      "total_cached_input_tokens": 1250000,
      "cached_token_rate": 0.35,
      "avg_cost_per_1k_prompt_turn2plus": 0.0021
    },
    "by_turn": [
      { "turn_index": 1, "count": 120, "avg_latency_ms": 820, "avg_ttft_ms": 650, "avg_cached_tokens": 0 },
      { "turn_index": 2, "count": 118, "avg_latency_ms": 420, "avg_ttft_ms": 190, "avg_cached_tokens": 8000 }
    ],
    "comparison_hint": "Compare two pools: one with session_affinity_enabled=1, one without."
  }
}
```

核心 SQL 模式：

```sql
-- Stickiness
SELECT
  COUNT(*) FILTER (WHERE affinity_applied = 1) * 1.0 / NULLIF(COUNT(*), 0) AS applied_rate,
  COUNT(*) FILTER (WHERE affinity_hit = 1) * 1.0 / NULLIF(COUNT(*) FILTER (WHERE affinity_applied = 1), 0) AS hit_rate
FROM usage_logs
WHERE session_id IS NOT NULL AND timestamp >= ?;

-- Turn-based latency lift
SELECT turn_index,
       AVG(latency_ms) AS avg_latency,
       AVG(ttft_ms) AS avg_ttft,
       AVG(cached_input_tokens) AS avg_cached
FROM usage_logs
WHERE session_id IS NOT NULL AND turn_index IS NOT NULL
GROUP BY turn_index
ORDER BY turn_index;
```

### 7.2 现有 `GET /api/admin/stats`

可选增加摘要字段 `warming_summary`（hit_rate、turn2_lift），避免 Stats 页多一次请求。

---

## 8. Admin UI

在 [Statistics](../../web/src/pages/stats/Statistics.tsx) 增加 **Warming** 区块（或独立 `/stats/warming`）：

| 卡片 | 展示 |
|------|------|
| Session 覆盖率 | 带 session_id 的请求占比 |
| Affinity hit rate | sticky 命中率 |
| Turn 2+ TTFT | 与 turn 1 对比（含 lift %） |
| Cached tokens | 总量 + 占 prompt tokens 比例 |
| By turn 表格 | turn_index → latency / ttft / cached |

Pool 详情页 [PoolDetails](../../web/src/pages/PoolDetails.tsx)：

- `session_affinity_enabled` 开关
- `session_affinity_ttl_secs` 输入
- 该 pool 的 warming 迷你统计（链到 stats/warming?pool_id=）

i18n：`en.json` / `zh.json` / `ja.json` / `ko.json` 同步。

---

## 9. A/B 验证方法

1. 创建两个结构相同的 Pool（同 endpoints、同 strategy），仅 `session_affinity_enabled` 不同。
2. 两个 Virtual Model 指向各自 Pool；agent 随机或按 key 分流。
3. 客户端统一传 `X-SmartGate-Session-Id`。
4. 跑固定 benchmark task set（如 10-turn coding agent），对比 7 天窗口：

| 指标 | 有 affinity | 无 affinity | 判定 |
|------|-------------|-------------|------|
| turn≥2 avg TTFT | ↓ | 基线 | lift > 20% 且显著 |
| affinity_hit_rate | > 85% | N/A | stickiness 有效 |
| cached_input_tokens / prompt_tokens (turn≥2) | ↑ | 基线 | cache 生效 |
| estimated_cost / turn (turn≥2) | ↓ | 基线 | 成本收益 |

单 endpoint pool：**跳过** affinity，UI 提示「无 warming 收益」。

---

## 10. 实现顺序

| 阶段 | 内容 | 文件触达 |
|------|------|----------|
| **A** | session_id 提取 + 落库 + turn_index | `proxy.rs`, `usage/mod.rs`, migration |
| **B** | Session Store + feedback boost | `policy/route_hint.rs`, `routing/mod.rs`, 新 `policy/affinity.rs` |
| **C** | UniGateway cache/TTFT 透传 | UniGateway + `usage/mod.rs` |
| **D** | `/api/admin/stats/warming` + UI | `stats_handler.rs`, `Statistics.tsx`, i18n |
| **E** | Pool 配置 + harness 文档 | `admin.rs`, `Pools.tsx`, `harness.md` |

阶段 A 单独上线即可开始收集 session 维度数据；B 启用实际 warming；C 补齐 cache/TTFT 证据链。

---

## 11. 边界与风险

| 风险 | 缓解 |
|------|------|
| 多 replica 各进程 binding 不一致 | P2 接受；文档注明单进程 / sticky LB；P3 可选 Redis |
| Sticky 到慢 endpoint | affinity 仅 boost 健康 endpoint；TTL 过期重选 |
| session_id 碰撞 | 建议 `{harness}-{task}-{uuid}` |
| Context slim 改变 prefix | slim 在 hash **之前**或之后需固定；**建议 hash 用 slim 后 body**（与实际上游一致） |
| Provider 无 cache | cached_input_tokens 恒为 0；仍可用 latency / stickiness 评估 |

---

## 12. 与现有能力关系

- **Context slim**：独立优化线，不依赖 session_id（见 [scope.md](../scope.md) §5.4）。
- **Cost/Capability routing**：affinity 为 overlay，downshift / health exclusion 优先于 stickiness。
- **Routing decisions 页**：可复用 `routing_decision.warming` 做请求级 drill-down。

---

## 13. 验收标准

1. 多 endpoint pool 开启 affinity 后，`affinity_hit_rate` ≥ 85%（健康 endpoint 充足时）。
2. turn ≥ 2 的 `avg_ttft_ms` 相对无 affinity 同 workload 下降 ≥ 20%（cache 支持的 provider）。
3. `usage_logs` 可按 `session_id` 串联完整 turn 序列。
4. Admin UI 可见 warming 摘要，无需直连 SQL。
5. 单 endpoint pool、无 session_id 请求行为与现网一致（零回归）。
