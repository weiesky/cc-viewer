# Changelog

## 1.0.16 (2026-02-24)

- Added "View in chat" button on Request/Response detail tabs to jump to the corresponding conversation message
- Highlighted target message with animated rotating dashed border and blue glow on navigation; fades out on scroll
- Smart scroll positioning: tall messages align to top, short ones center in viewport
- Changed default settings: collapse tool results and expand thinking are now enabled by default
- Removed package-lock.json from version control

## 1.0.15 (2026-02-24)

- Cache rebuild analysis now precisely identifies the cause: system prompt change, tools change, model switch, message stack truncation, or message content modification (previously only showed a generic "key change" reason)
- Added comprehensive Claude Code tools reference documentation (23 files in concepts/): index page (Tools.md) and detailed docs for all 22 built-in tools

## 1.0.14 (2026-02-24)

- Request list auto-scrolls to selected item on initialization and mode switch (centered); manual clicks use nearest scroll
- Chat mode: "View Request" button on each message to jump back to raw mode at the corresponding request
- Bidirectional mode sync: switching from raw to chat scrolls to the conversation matching the selected request; switching back scrolls to the selected request
- Toast notification when a non-MainAgent request cannot be mapped to a conversation

## 0.0.1 (2026-02-17)

- 初始版本发布
- 拦截并记录 Claude API 请求/响应
- 实时 SSE 推送，Web 面板查看请求详情
- 支持流式响应组装与展示
- JSON Viewer 可视化请求/响应体
- 对话模式视图
- 构建脚本，将源码与 vendor 依赖打包至 `lib/`
