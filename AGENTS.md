# AI Agent 协作规则

## 项目规范

### SmartGate 与 UniGateway 边界

产品范围见 `docs/scope.md`；路线图见 `docs/roadmap.md`。

- **SmartGate 是控制面 / 数据面分离的全功能 AI 网关**。控制面负责产品配置、组织/项目/API Key、Provider Account、Endpoint、Virtual Model、Model Pool、路由策略打分、鉴权、配额/预算、Token 与花费统计、健康策略和 Admin UI。
- **UniGateway 是数据面协议与执行引擎**，负责协议层语义转换、provider driver、上游请求渲染、下游响应归一化、流式协议处理、SSE chunk 解析/重写和具体 provider 行为。
- **业务对象不得下沉到 UniGateway**：Org、Project、API Key、Provider Account、Model Pool、Virtual Model、Project Grant 等属于 SmartGate 控制面；UniGateway 不应依赖或理解这些产品层对象。
- **协议细节不得上浮到 SmartGate 控制面**：OpenAI/Anthropic 协议字段转换、provider-specific 请求体/请求头渲染、reasoning/thinking 字段解析、工具调用差异、流式响应差异等应优先在 UniGateway 中实现。
- SmartGate 可以维护 Endpoint 候选集、健康状态、优先级、权重、运行时指标和路由反馈分数，并将中立 metadata 或 `unigateway.*` hints 传给 UniGateway；但不得在 API handler 中把这些 metadata 翻译成特定 provider 的 body 参数。
- SmartGate 的路由职责是 **策略计算**（Priority / LoadAware / CostAware / CapabilityAware 等），生成 UniGateway 可执行的候选顺序与 feedback。
- UniGateway 的路由职责是 **执行机制**：按候选 endpoint、feedback 与中立 metadata 完成协议渲染、请求执行、fallback、响应归一化与报告。
- 若 UniGateway 的 fallback、ordered endpoints 或 driver 不足，优先增强 UniGateway 机制，而不是在 SmartGate handler 里硬编码 provider/协议逻辑。
- API Key 绑定 Project，并可显式授权一个或多个 Model service（Virtual Model）；Virtual Model → Model Pool → Endpoints。API Key 不直接绑定 Endpoint，也不承载 provider-specific 行为。请求中的 `model` 使用被授权的 Model service 名称。历史 key 若没有显式 service 授权记录，可兼容继承其 Project 的 service 授权。
- **不做 meta-harness**（任务级 harness 选择、共驾 session、OS sandbox）；那是 Omnigent 等客户端层。SmartGate 做请求级模型路由与公司级花费治理。
- 修复前先判断问题属于控制面（配置/策略/预算）还是数据面（协议/driver）；边界不清时先说明归属。

### Language & Documentation Standards

- **All SmartGate content must be in English**: This includes code comments, Rust docstrings, API error messages, commit messages, architecture documents, and README.
- In UI localization files (`en.json`, `zh.json`, `ja.json`, `ko.json`), English (`en.json`) is the primary source of truth.
- Do not add Chinese comments or docstrings in backend/frontend source code.

### 文件组织

- **严禁在根目录放置临时或测试脚本**。
- 所有测试脚本应根据所属模块放置在对应目录的 `tests/` 或 `scripts/` 下（例如 `src/tests/`）。
- 根目录应保持整洁，仅包含项目配置文件及必要的说明文档。

### 文档命名与归档

- `docs/` 下的文档文件名应保持简短清晰，避免使用过长的复合名称。
- 当文档需要表达模块、阶段、方案、RFC 等附加区分时，优先使用子目录分类，而不是继续拉长文件名。
- 新增文档时，优先放入对应主题目录，例如 `docs/unigateway/`、`docs/ui/`、`docs/design/`。
- 文档重构后应保持 `docs/` 顶层目录可快速浏览，必要时更新索引文档。

### 前端 UI

#### 下拉选择

产品界面中的选项列表（状态、筛选条件、枚举字段等）**不得使用原生 HTML `<select>`**，应使用项目内封装组件 `web/src/components/Select.tsx`（或经评审的同等可访问自定义下拉），以保持样式一致并避免浏览器默认控件在弹窗、主题与交互上与整体设计脱节。

#### 多语言规范

- 所有新增的 UI 文本（包括标签、提示语、CTA 等）**必须同步更新至所有现存的本地化文件** (`en.json`, `zh.json`, `ja.json`, `ko.json`)。
- 禁止在前端组件中直接硬编码中文或英文文案。
- 如果不确定翻译，请优先提供准确的英文，并明确标注待补充语种，避免仅维护单一语言。

#### 信息布局规范

- 不要使用居中点（`·`）或类似符号在同一行中分割多条信息。这种做法会降低可读性并破坏对齐；应使用独立行、明确的间距或其他清晰的布局方式展示信息。
- 卡片中的并列信息应优先顶部对齐；内容较多的字段不得通过底部对齐把其他字段的标题顶到不同位置。

#### SaaS 资源操作

- API key、Model service、Provider 等资源的创建、编辑、授权和删除操作，默认不得把完整表单长期平铺在页面内容中；应使用页面右侧或顶部的主操作按钮打开弹窗完成。
- API key 创建弹窗必须允许选择一个或多个 Model service，并明确说明 API key 用于客户端调用、请求中的 `model` 使用所选 service 名称。
- 资源列表只展示摘要和状态；详细配置、授权关系和敏感字段应在弹窗或详情交互中处理。

#### 页面标题与注释简洁规范

- **禁止重复堆叠多级标题**：每个页面或区块保持单一明确的标题，严禁在页面顶部同时堆叠重复的 Eyebrow 标签、大标题和重复的模块名称。
- **界面注释与说明极简化**：页面主体禁止平铺大段冗长的解释性文字。若确需提供背景说明、指引或辅助解释，应使用统一的信息图标标记（如 `<HelpCircle>` / `<Info>`），并通过鼠标悬停（Hover Tooltip / `title` 属性）展示注释内容，保持页面视觉清爽与紧凑。

## 部署纪律


### 代码提交后必须监控部署状态

任何代码推送到 main 分支后，必须立即监控 GitHub Actions 部署状态，直到确认成功或失败。

**执行步骤**：
1. 推送代码后立即获取最新 workflow run ID
2. 使用 `gh run watch <run-id>` 实时监控
3. 确认 deployment job 成功完成

**命令示例**：
```bash
# 推送代码后获取 run ID
gh run list -L 1 --json databaseId

# 监控部署状态
gh run watch <databaseId>
```

**失败处理**：
- 若部署失败，立即查看日志定位问题
- 修复后重新提交并再次监控
- 不要将监控任务留给用户
