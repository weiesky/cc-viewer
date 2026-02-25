# Changelog

## 1.2.1 (2026-02-25)

- Open local logs: current project now sorted to top of the list
- Open local logs: replaced row-click-to-open with explicit "Open" button; clicking row now toggles checkbox selection
- Open local logs: "Merge Logs" button only appears when 2+ logs are selected
- Open local logs: "Open" and "Merge Logs" buttons styled as primary blue buttons
- User Prompt modal title now shows prompt count
- Added Body Diff JSON concept doc with (?) help button
- Body Diff JSON now filters out `_timestamp` and other private keys from nested objects
- Request list status code color unified to #52c41a with 0.5 opacity
- Concept help modal background adjusted to #1a1a1a/#111

## 1.2.0 (2026-02-25)

- Added log merge feature: combine multiple JSONL log files into a single session for unified analysis
- Added Skill usage statistics in Dashboard, showing call counts per skill alongside tool stats
- Added Skills reminder detection and filtering in system-reminder handling
- Export user prompts now supports three view modes: Original (raw), Context (with system tags), and Text (plain text)
- Renamed "Import local logs" to "Open local logs" and "Export user prompts" to "View user prompts" for clarity

## 1.1.1 (2026-02-25)

- Auto-open browser on startup for Claude Code versions before v2.0.69 (older versions may clear console output)

## 1.1.0 (2026-02-25)

- Added ConceptHelp component: click (?) icon next to tool names and titles to view concept docs in a modal
- Added concept doc API endpoint (GET /api/concept) serving markdown files with i18n fallback
- Added tool usage statistics column in Dashboard, showing call counts per tool with ConceptHelp links
- Added system-reminder filter (CLAUDE.md) in request body view, auto-expands matching nodes
- Added breathing animation for live monitoring badge; history logs show muted style
- Dashboard cards now have darker background (#111) for better contrast
- Increased max log file size from 200MB to 500MB
- Cache rebuild analysis now uses stripped keys for more accurate diff comparison
- Body Diff section layout improved: view toggle and copy button inline with title
- Diff computation skips private keys (prefixed with _)

## 1.0.17 (2026-02-25)

- Added cache rebuild statistics card in Dashboard, grouped by reason (TTL, system/tools/model change, message truncation/modification, key change) with count and cache_creation tokens
- Added "Expand Diff" setting toggle; MainAgent requests auto-expand diff section when enabled
- Diff section now supports JSON/Text view switching and copy button
- ChatView smart auto-scroll: only scrolls to bottom when user is already near the bottom
- Extended highlight fade-out animation from 2s to 5s for better visibility

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
