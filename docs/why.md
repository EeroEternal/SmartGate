# Why ParaGateway (legacy)

> **Product rename:** This document predates the **SmartGate** brand.  
> Canonical scope: [scope.md](./scope.md). Engineering plan: [plan.md](./plan.md).  
> ParaGateway remains a historical name for the same codebase lineage.

## 背景

SmartGate（原 ParaGateway）的目标不是重新实现一个协议网关，而是在 UniGateway 之上构建 **控制面**（产品、策略、治理），数据面由 UniGateway 承担。它可以吸收 XRouter 在企业路由、模型池、访问控制和用量统计上的经验，但不应该复制 UniGateway 已经承担的协议转换、provider driver、请求执行和响应归一化能力。

因此，ParaGateway 的设计方向是：

```text
ParaGateway = 企业控制平面
UniGateway = 协议与执行引擎
```

ParaGateway 负责产品配置、组织、项目、API Key、模型池、虚拟模型、路由策略打分、权限、配额和统计。UniGateway 负责 OpenAI / Anthropic 等协议转换、provider driver、请求体渲染、响应体适配、SSE 流处理和 endpoint dispatch 机制。

更准确地说，ParaGateway 吸收 XRouter 的企业路由和管理模型，但协议层、provider 适配层和请求执行层尽量交给 UniGateway。

## 为什么以 Model Pool 为中心

如果管理员需要直接面对下面这条链路，系统会很快变得难以理解和维护：

```text
服务商 -> 实例 -> 模型 -> 策略 -> 组织 -> 项目 -> API Key -> 映射
```

更合理的交互对象应该是：

```text
Provider / Endpoint 作为底层资源
Model Pool 作为调度单元
Virtual Model 作为对外暴露名称
Project / API Key 作为访问控制入口
```

管理员真正关心的是：有哪些模型能力，这些能力来自哪些供应商，谁可以使用，成本、稳定性和延迟如何。管理员不应该在日常配置中关心每个请求最终打到哪个具体 endpoint。

Model Pool 可以把多个兼容 endpoint 聚合成一个调度单元。例如一个 `gpt-4-enterprise` 池子可以同时包含 Azure 的多个 deployment 和 OpenAI 的一个 endpoint，然后在池子级别配置 Priority、Latency-Based 或 Least Connections 策略。

## 产品模型选择

### 资源层：Provider Account + Endpoint

设计上不直接把所有上游都叫做 Provider，因为 Provider 容易混淆供应商类型、账号配置和具体可调用实例。

更清晰的拆分是：

```text
Provider Template: OpenAI / Azure OpenAI / DeepSeek / Anthropic / 阿里云
Provider Account: 某个账号配置，包含 API Key / Base URL / Region
Endpoint: 具体可调用的模型实例或 deployment
```

例如：

```text
Provider Template: Azure OpenAI
Provider Account: azure-prod-eastus
Endpoint:
  - gpt-4o-prod-eastus
  - gpt-4o-mini-prod-eastus
```

这样可以自然支持多账号、多区域、多 deployment 和多 endpoint 管理。

### 调度层：Virtual Model -> Model Pool -> Endpoint

Virtual Model 是 API 使用者看到的稳定模型名。例如调用方只需要请求：

```json
{
  "model": "fast-chat"
}
```

ParaGateway 内部解析为：

```text
fast-chat -> DeepSeek-Pool -> endpoint candidates
```

这个设计有两个核心收益。

第一，业务代码稳定。后端从 DeepSeek 切到 Azure，或者从单 endpoint 切到多 endpoint 池，调用方都不需要改代码。

第二，权限模型更清楚。Project 只需要授权 `fast-chat`、`code-agent`、`premium-reasoning` 这类虚拟模型，而不是授权一堆 provider endpoint。

### 接入层：Org 可选，Project 必选，API Key 绑定 Project

组织层不应该在初期设计中过重。默认体验可以是：

```text
Default Org
  -> Default Project
    -> API Key
```

高级用户再启用多组织、多项目。

API Key 不应该直接绑定 Pool、Strategy 或 Endpoint。推荐链路是：

```text
API Key -> Project
Project -> Allowed Virtual Models
Virtual Model -> Model Pool
Model Pool -> Endpoints
```

这样权限关系清楚，endpoint 变更也不会影响 API Key 使用者。

需要避免的复杂链路是：

```text
API Key -> Org
API Key -> Project
API Key -> Pool
API Key -> Strategy
API Key -> Endpoint
```

这种设计会导致权限、路由和资源配置耦合，后续很难维护。

## ParaGateway 与 UniGateway 的边界

UniGateway 不应该理解 ParaGateway 的业务概念，例如 Org、Project、API Key、Model Pool、Virtual Model 或 Project Grant。

更合理的分工是：

```text
ParaGateway:
  解析 API Key
  判断 Project 权限
  解析 Virtual Model
  找到 Model Pool
  过滤可用 Endpoint
  计算 endpoint score / priority / weight
  构造 UniGateway 可执行的候选 endpoint 和 routing feedback

UniGateway:
  按候选 endpoints 和 feedback 执行请求
  处理 provider 协议转换
  渲染上游请求
  归一化下游响应
  处理流式协议
  输出 hooks 和 request report
```

也就是说，Pool ID、Project ID、Org ID 等是 ParaGateway 的产品概念，不应成为 UniGateway 必须理解的业务对象。UniGateway 最多接收 endpoint list、routing feedback、metadata hints 等中立输入。

如果某个 provider 需要特殊请求体、特殊响应解析、reasoning 字段转换或 SSE chunk 重写，应优先在 UniGateway 中增强 driver 或协议层，而不是在 ParaGateway API handler 里硬编码。

## 管理员交互设计

管理员界面应该降低首次配置成本，同时保留企业场景所需的精确管理能力。

推荐的新用户路径是：

```text
1. 添加 Provider Account
2. 自动发现或手动添加 Endpoint
3. 创建 Model Pool
4. 创建 Virtual Model
5. 创建 Project API Key
```

UI 上可以进一步合并为向导：

```text
Add Provider
  -> Select Models
  -> Create Virtual Model
  -> Issue API Key
```

高级配置可以放在更深层入口中，包括 Pool 策略、Endpoint 权重、Fallback 顺序、Project 配额、模型权限、并发限制和用量统计。

首页可以做成路由状态大盘，展示 Model Pool 健康状态、流量、延迟、失败率和 token 使用量。但看板不应该替代配置页。系统仍然需要清晰的配置入口：Providers、Endpoints、Model Pools、Virtual Models、Projects、API Keys 和 Usage。

## 路由策略取舍

MVP 阶段不应该一次性实现过多策略。优先实现三个策略即可：

```text
Priority
Latency-Based
Least Connections
```

Lowest Price 可以作为后续扩展。价格路由依赖价格元数据、计费单位、缓存价格、特殊模型价格和不同 provider 的计价规则。如果过早实现，会显著增加复杂度。

路由策略的职责边界也需要保持清晰。ParaGateway 负责策略计算，例如 EMA 延迟、活动连接数、优先级、权重和健康状态。UniGateway 负责执行机制，例如按候选 endpoint 顺序 dispatch、fallback、tie-breaking 和响应归一化。

如果 UniGateway 当前的 fallback、ordered endpoints 或 tie-breaking 机制不够，应优先在 UniGateway 中增强通用机制，而不是把 provider 或协议逻辑写入 ParaGateway。

## 数据模型关键点

ParaGateway 至少需要以下核心表来支撑企业控制平面：

```text
orgs
projects
api_keys
provider_accounts
endpoints
model_pools
model_pool_endpoints
virtual_models
project_model_grants
usage_logs
endpoint_metrics
```

其中最关键的是：

```text
virtual_models
model_pools
model_pool_endpoints
project_model_grants
```

这几个对象决定系统能否自然支持稳定模型名、模型池调度、endpoint 聚合和项目级权限。

## 设计结论

ParaGateway 的产品定位是：企业 AI 模型资源控制平面，负责权限、路由、统计和策略；UniGateway 是底层协议与执行引擎。

最终设计应坚持三个收敛原则。

第一，UniGateway 不理解业务对象，只负责协议和执行。

第二，API Key 只绑定 Project，Project 再授权 Virtual Model，避免权限关系爆炸。

第三，Org 先做轻量默认层，不要一开始把组织、项目、池子、策略和 Key 全部暴露成强制配置项。

这个设计可以同时满足企业复杂度和首次使用体验：小部署可以用默认组织和默认项目快速跑起来，大部署可以逐步启用多组织、多项目、多模型池、多 endpoint 和精细化策略。
