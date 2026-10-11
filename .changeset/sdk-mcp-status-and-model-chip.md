---
"cc-viewer": patch
---

feat(sdk): SDK 模式补齐两块控制面 — ① 接通 `mcpServerStatus()`:新增 `GET /api/sdk-mcp-server-status` 按需拉取(身份守卫防代际串扰 + 10s 超时防楔 + 数组守卫反转——空数组 `[]` 是合法"无 MCP 服务器"结果而非失败),详情面板新增 SDK-only「MCP 状态」标签页按 server 列出连接状态徽标/版本/工具数/failed 错误文本(MCP 状态不与回合相关,故走按需拉取+WS 重连回放+切会话清帧,不挂 turn-end 触发器);② `sdkModel` 死状态接通渲染:SDK 启动模型提升到 AppBase,在 AppHeader 代理热切换 chip 槽位作**回退**展示(热切换优先——仅当代理 chip 不渲染的官方 Default 场景才露头,只读不可点击,样式独立于 proxyProfileTag 以免被其源契约测试误捕)。另同步 17 个翻译版 README 的 SDK 段(`ccv -SDK`→`--sdk`、"no terminal panel"→承认 Header scratch 终端)。Coverage: `sdk-manager-query.test.js`, `sdk-mcp-status-route.test.js`, `mcp-status-view.test.js`, `sdk-mcp-status-tab.test.js`, `mcp-status-i18n.test.js`, `sdk-model-chip.test.js`, `sdk-model-wiring.test.js`, `new-ui-i18n.test.js`. resume 切会话时清空 `sdkModel` 防陈旧,并删除 ChatView 冗余的 `state.sdkModel`(AppBase 单一事实源)。

fix(web): **修复两个 SDK 面板的无限拉取环** — `SdkMcpStatusTab` 与其克隆母版 `SdkContextUsageTab` 此前用 `useState+useCallback([detail,status])` 驱动面板状态:每次成功拉取返回新 ts → 新 detail 对象 → dispatch/load 身份变更 → 挂载 effect 重跑 → 再次 load(),在真 react@18.3.1 下以 ~1 请求/RTT 无限自旋(且服务端 `fetchMcpStatus`/`fetchContextUsage` 每轮向所有 WS 客户端广播,跨客户端放大)。改为 `useReducer`(dispatch 身份恒定),effect 仅在 `ws` 变化时跑一次;新增 `sdk-panel-stable-dispatch.test.js` 源契约防回归。
