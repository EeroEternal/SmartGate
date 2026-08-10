# Provider、Endpoint 与 Model Pool 的路由关系

本文说明 SmartGate 中 Provider、Provider Account、Endpoint、Model Pool 和 Model service 的职责边界，避免将 Provider 误解为一个独立的路由层级。

## 核心结论

SmartGate 当前不是“先选择 Provider，再在 Provider 内选择模型”的两级路由模型。系统把一个具体的“Provider Account + 上游模型”组合建模为一个 Endpoint，并直接在 Endpoint 层完成候选、评分、健康检查和 fallback。

```text
Model service / Virtual Model
  -> Model Pool
    -> Endpoint
      -> Provider Account + upstream_model_id
```

因此：

- **Provider 类型**（例如 OpenAI、DeepSeek、阿里云、Anthropic）主要是类型标识、协议和管理元数据，不是独立的路由选择单位。
- **Provider Account** 是实际的上游连接配置，提供 Base URL、凭证、协议、账号状态等信息。
- **Endpoint** 是真正的路由单位，表示某个 Provider Account 下的一个可调用模型或 deployment。
- **Model Pool** 将多个能力兼容的 Endpoint 聚合为一个调度单元。
- **Model service / Virtual Model** 是对客户端暴露的稳定名称，不暴露最终使用的 Provider 或真实模型名。

## 各层职责

### Provider 类型

Provider 类型描述上游服务属于哪一类，例如：

```text
openai
anthropic
deepseek
aliyun
```

它可以用于：

- 标识 Provider 家族；
- 选择或描述协议适配；
- 管理后台分类和展示；
- Usage 按 Provider 聚合；
- 向 UniGateway 传递中立元数据。

Provider 类型本身不保存一个具体请求应该使用的模型，也不单独参与 Pool 内的排序。

### Provider Account

Provider Account 表示一个具体的上游账号或连接实例，通常包含：

- Provider 类型；
- Base URL；
- API Key 或其他凭证引用；
- 协议类型；
- 账号名称和状态；
- 区域等连接元数据。

这些配置会在请求执行时真正使用。例如，选中某个 Endpoint 后，UniGateway 会使用它关联的 Provider Account 的 URL、凭证和协议连接上游。

Provider Account 可以拥有多个 Endpoint：

```text
Provider Account: aliyun-production
  - Endpoint: qwen-plus
  - Endpoint: qwen-turbo
```

### Endpoint

Endpoint 表示一个具体可调用的上游目标，核心是：

```text
Provider Account + upstream_model_id
```

例如：

```text
endpoint-1 = aliyun-production + qwen-plus
endpoint-2 = aliyun-production + qwen-turbo
endpoint-3 = deepseek-production + deepseek-chat
```

Endpoint 维护路由所需的属性，包括：

- Pool 内的 priority 和 weight；
- enabled 和健康状态；
- 输入、输出价格；
- capability score；
- 是否支持工具调用；
- 上下文长度；
- 延迟、错误率、活动请求数等运行时指标。

因此，路由系统比较的是 `endpoint-1`、`endpoint-2`、`endpoint-3`，而不是先比较 `Aliyun` 和 `DeepSeek` 两个 Provider。

## 多 Provider、多模型的路由示例

假设对外提供一个 Model service：

```text
fast-chat
```

它绑定多个 Provider，每个 Provider 又有多个模型：

```text
DeepSeek
  - deepseek-chat
  - deepseek-reasoner

Aliyun
  - qwen-plus
  - qwen-turbo
```

系统会建立四个 Endpoint，并将它们加入同一个 Model Pool：

```text
fast-chat
  -> fast-chat-pool
    -> DeepSeek / deepseek-chat
    -> DeepSeek / deepseek-reasoner
    -> Aliyun / qwen-plus
    -> Aliyun / qwen-turbo
```

客户端只请求：

```json
{
  "model": "fast-chat"
}
```

SmartGate 先解析并授权 `fast-chat`，再将请求交给对应的 Pool。路由策略从 Pool 的 Endpoint 候选集中选择一个目标。选中后，UniGateway 使用该 Endpoint 关联的 Provider Account 和 `upstream_model_id` 发起请求。

例如：

- 选中 `Aliyun / qwen-plus` 时，上游模型名是 `qwen-plus`；
- 选中 `DeepSeek / deepseek-chat` 时，上游模型名是 `deepseek-chat`。

客户端始终只看到 `fast-chat`。

## Endpoint 层的路由策略

Pool 的策略作用于 Endpoint 候选集，可以包括：

- **Round Robin**：在候选 Endpoint 之间轮询；
- **Priority**：优先使用高优先级 Endpoint；
- **Weight**：按 Endpoint 权重分配流量；
- **Cost aware**：根据本次请求预计 Token 和 Endpoint 价格选择成本更低的目标；
- **Latency / Load aware**：根据延迟、活动请求数和错误率排序；
- **Capability aware**：根据工具调用、上下文长度和能力分数过滤或排序；
- **Fallback**：当前 Endpoint 执行失败后，按候选顺序尝试其他 Endpoint。

SmartGate 控制面负责计算策略、健康排除和反馈分数；UniGateway 数据面负责协议渲染、请求执行、fallback、响应归一化和流式处理。SmartGate 不应在 API handler 中将路由元数据翻译成 Provider 特有的请求体字段。

## 能力兼容性要求

放入同一个 Model Pool 的 Endpoint 应该具有相近且可互换的服务语义。不要仅因为多个模型都能返回文本，就把它们放进同一个 Model service。例如普通聊天模型、代码推理模型和图像模型通常不应共用同一个 Pool。

管理员应重点检查：

- 是否支持相同的协议和请求能力；
- 是否都支持所需的工具调用；
- 上下文长度是否满足 Model service 的要求；
- 能力分数和响应质量是否处于同一档位；
- 价格差异是否符合该 Model service 的预期。

当前系统通过 Endpoint 的能力、价格和健康属性辅助过滤与评分，但不会自动证明不同上游模型在语义上完全等价。

## Usage 统计

一次请求的使用记录可以同时保留逻辑层和物理层信息：

```text
virtual_model_id    = 客户端请求的 Model service
pool_id             = 实际使用的 Model Pool
endpoint_id         = 最终选中的具体 Endpoint
provider_account_id = Endpoint 关联的 Provider Account
upstream_model_id   = Endpoint 对应的上游模型
```

因此 Usage 页面可以按以下层级展示：

```text
Model service
  -> Provider Account / Provider
    -> upstream model
```

这既能回答“哪个 Model service 消耗了多少”，也能回答“最终实际打到了哪个 Provider 和哪个模型”。

## 当前设计的边界

当前设计不把 Provider Account 作为独立的路由组，因此默认按 Endpoint 记录健康状态和流量。系统目前没有要求对一个 Provider Account 执行整体熔断、整体限流或整体预算。

如果未来需要 Provider 级别的限流、配额或故障隔离，可以在 Model Pool 和 Endpoint 之间增加 Provider Group 层；这将是明确的两级路由扩展，而不是当前 Endpoint 路由模型的一部分。
