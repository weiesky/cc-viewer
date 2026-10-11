---
"cc-viewer": patch
---

feat(sdk): 新增「Context 用量」面板 — 常驻 query 接通 `getContextUsage` 控制请求:回合结束及 compact 后自动拉取并广播 `sdk-context-usage`(WS 重连回放快照、切会话广播清帧),新增 `GET /api/sdk-context-usage` 按需拉取;请求详情面板新增 SDK-only「Context 用量」标签页,按类别构成条(含 auto-compact 阈值刻度)/上下文网格/记忆文件/MCP 工具/系统提示分节/子代理/技能/消息明细全字段渲染(18 语言)。control 失败仅 `reportSwallowed`,不打扰 UI。Coverage: `sdk-manager-query.test.js`, `sdk-context-route.test.js`, `context-usage-view.test.js`, `context-i18n.test.js`.
