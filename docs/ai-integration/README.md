# QuickMap 开放式问地图：接入脚手架

状态：**通用地图解答的本地控制、验证、保存、图文展示和双向定位已接通；地图内 DeepSeek 接口、开放式搜索和模型自动生成图文计划仍未接通。** 不要把当前霍尔木兹问答预览当作开放式 AI。

## 现在的 Codex 接法与账号边界

现有 `electron/map-codex.ts` 在本机用 `spawn` 启动官方 `codex app-server`，通过标准输入输出上的 JSON-RPC 调用 `initialize`、`thread/start`、`turn/start`，接收流式事件。它使用本机 Codex 已登录状态，不读取浏览器 Cookie，不调用网页私有接口，不在仓库存放登录凭证，也不与当前 Codex 桌面对话共享线程。`electron/main.ts` 通过受信 IPC 把回答送给地图。

这是 [OpenAI 官方列出的产品内集成接口](https://learn.chatgpt.com/docs/app-server)。这说明接法有正式文档支持，但不能据此承诺任何账号永不受限；仍须遵守账号、工作区、用量及工具授权规则。不要抓取令牌、复用私有请求、绕过限额或把同一登录共享给其他用户。地图窗口不要直接暴露 app-server 端口或凭证。

当前实现把网络、MCP、shell、插件和工具调用关闭，模型只读预置霍尔木兹资料。话题限制来自 QuickMap 自己的提示词与结果校验；下一版应取消话题白名单，同时保留正常操作授权和地图数据校验。

## 演示用 DeepSeek 接法

推荐做一个**独立的 HTTP provider 适配器**，由 Electron 主进程直连 `https://api.deepseek.com`，以用户提供的 `DEEPSEEK_API_KEY` 鉴权；不要修改用户全局 `~/.codex/config.toml`，也不要让 DeepSeek 演示消耗 OpenAI 登录。DeepSeek 官方文档列有 [Responses API、流式输出和函数调用](https://api-docs.deepseek.com/guides/responses_api/)。它的兼容层不会执行内置 `web_search`、`mcp` 等工具，因此新闻和数据核验必须由 QuickMap 自己的搜索/来源服务完成，再将可信来源 ID 交给模型。

建议配置：`QUICKMAP_AI_PROVIDER=deepseek|codex`、`DEEPSEEK_API_KEY`、`QUICKMAP_DEEPSEEK_MODEL`。选择了 DeepSeek 但缺少密钥时显示明确错误，**不要悄悄回退到 Codex 登录**。密钥只在主进程读取；不经 renderer、IPC 响应、日志、截图、Git 或模型提示词传递。实现时加超时、取消、用量上限和错误状态。DeepSeek 会接收发给它的问题与必要的上下文，应在界面明确标明当前 provider。

## 共用契约

地图内问答与当前 Codex 对话操作地图，都应写入同一种 `MapAnswerPlan`。Zod 契约在 [`src/shared/map-answer-plan.ts`](../../src/shared/map-answer-plan.ts)：问题、标题、资料日期、段落、段落对应图层、来源 ID、地图要素 ID或经验证的 GeoJSON 几何。动态示意几何必须标成 `schematic`；有权威数据支持的几何可标成 `sourced` 并带来源和日期。城市点、行政边界、海路示意不得混淆。`MapAnswerDocument` 将计划和可信来源记录组合，由 `quickmap answer file.json` 交给受信本地控制端，打开后保存在本机用户数据目录。

模型输出只提出来源 **ID**；来源标题、URL 和摘录由可信检索层解析。主进程核对所有 ID、几何、范围和长度后再持久化及渲染。段落与图层双向定位，用户临时标注单独保存。模型可回答任何地理相关问题；当资料不足时说明不确定性，不能伪造来源或精确航迹。

## 开发顺序和验收

1. 将地图内 Codex 回答从霍尔木兹故事限制扩展为通用地理问题，连接可信搜索与来源登记；将模型提出的图文计划经验证后写成现有 `MapAnswerDocument`。保留正常工具授权、错误、取消和流式事件。
2. 加 `deepseek` provider 适配器，与 Codex 共用作品格式、地图动作验证和历史记录。DeepSeek 在没有用户密钥时用本地 mock 测试，不发真实请求。
3. 把现有霍尔木兹故事迁移到共用契约，统一作品列表；用 1280×800 / 1920×1080 实窗验证地图内开放式提问和 provider 切换。

当前本地控制路径已有[北极航线示例](../examples/arctic-dalian-answer.json)，但它由当前 Codex 对话查证、组装再发送；地图内模型尚不能自行完成同一问题。不要把 `npm test` 通过解释为 DeepSeek 或地图内开放式问答已实测。
