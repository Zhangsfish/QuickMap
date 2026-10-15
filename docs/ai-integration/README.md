# QuickMap 开放式问地图：接入脚手架

状态：**架构和数据契约已建立；DeepSeek 接口、开放式搜索和 UI 尚未接通。** 不要把当前霍尔木兹问答预览当作开放式 AI。

## 现在的 Codex 接法与账号边界

现有 `electron/map-codex.ts` 在本机用 `spawn` 启动官方 `codex app-server`，通过标准输入输出上的 JSON-RPC 调用 `initialize`、`thread/start`、`turn/start`，接收流式事件。它使用本机 Codex 已登录状态，不读取浏览器 Cookie，不调用网页私有接口，不在仓库存放登录凭证，也不与当前 Codex 桌面对话共享线程。`electron/main.ts` 通过受信 IPC 把回答送给地图。

这是 [OpenAI 官方列出的产品内集成接口](https://learn.chatgpt.com/docs/app-server)。这说明接法有正式文档支持，但不能据此承诺任何账号永不受限；仍须遵守账号、工作区、用量及工具授权规则。不要抓取令牌、复用私有请求、绕过限额或把同一登录共享给其他用户。地图窗口不要直接暴露 app-server 端口或凭证。

当前实现把网络、MCP、shell、插件和工具调用关闭，模型只读预置霍尔木兹资料。话题限制来自 QuickMap 自己的提示词与结果校验；下一版应取消话题白名单，同时保留正常操作授权和地图数据校验。

## 演示用 DeepSeek 接法

推荐做一个**独立的 HTTP provider 适配器**，由 Electron 主进程直连 `https://api.deepseek.com`，以用户提供的 `DEEPSEEK_API_KEY` 鉴权；不要修改用户全局 `~/.codex/config.toml`，也不要让 DeepSeek 演示消耗 OpenAI 登录。DeepSeek 官方文档列有 [Responses API、流式输出和函数调用](https://api-docs.deepseek.com/guides/responses_api/)。它的兼容层不会执行内置 `web_search`、`mcp` 等工具，因此新闻和数据核验必须由 QuickMap 自己的搜索/来源服务完成，再将可信来源 ID 交给模型。

建议配置：`QUICKMAP_AI_PROVIDER=deepseek|codex`、`DEEPSEEK_API_KEY`、`QUICKMAP_DEEPSEEK_MODEL`。选择了 DeepSeek 但缺少密钥时显示明确错误，**不要悄悄回退到 Codex 登录**。密钥只在主进程读取；不经 renderer、IPC 响应、日志、截图、Git 或模型提示词传递。实现时加超时、取消、用量上限和错误状态。DeepSeek 会接收发给它的问题与必要的上下文，应在界面明确标明当前 provider。

## 共用契约

地图内问答与当前 Codex 对话操作地图，都应写入同一种 `MapAnswerPlan`。初始 Zod 契约在 [`src/shared/map-answer-plan.ts`](../../src/shared/map-answer-plan.ts)：问题、标题、资料日期、段落、段落对应图层、来源 ID、地图要素 ID或经验证的 GeoJSON 几何。动态示意几何必须标成 `schematic`；有权威数据支持的几何可标成 `sourced` 并带来源和日期。城市点、行政边界、海路示意不得混淆。

模型输出只提出来源 **ID**；来源标题、URL 和摘录由可信检索层解析。主进程核对所有 ID、几何、范围和长度后再持久化及渲染。段落与图层双向定位，用户临时标注单独保存。模型可回答任何地理相关问题；当资料不足时说明不确定性，不能伪造来源或精确航迹。

## 开发顺序和验收

1. 把现有霍尔木兹数据作为一个已保存的作品迁移到共用契约，并实现作品持久化、版本与双向定位。
2. 加 `codex` 和 `deepseek` 两个 provider 适配器，共用流式事件、取消、错误、工具授权及地图动作验证。DeepSeek 在没有用户密钥时用本地 mock 测试，不发真实请求。
3. 接可信搜索/来源服务，做“北极航线最近怎么样”演示：日期、来源、示意线路与文字联动；用 1280×800 / 1920×1080 实窗验收，并验证换 provider 不改变作品格式。

当前文件只完成了**数据契约与交接设计**，尚未完成上述运行时。不要把 `npm test` 通过解释为 DeepSeek 或开放式问答已实测。
