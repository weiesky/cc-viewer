# Changelog

## 1.3.8 (2026-03-01)

- Feat: inflight request detection — write request entry before fetch, deduplicate by timestamp+url on read; live spinner and popover for in-flight requests
- Feat: GitHub stars count displayed in footer
- Feat: log turns count shown per log file in log management tool (read from project stats cache)
- Feat: merge logs button always visible (disabled when < 2 selected) for better discoverability
- Style: Tooltip arrow now points at the live dot instead of the whole tag
- Style: global antd Tooltip override — background #090909 including arrow
- Style: log management tags use subtle dark style (black bg, gray border) instead of colored tags

## 1.3.7 (2026-03-01)

- Feat: SubAgent chat messages now interleaved in chat view timeline, with dedicated `sub-agent-chat` rendering
- Refactor: extracted `renderHighlightBubble()` and `renderAssistantContent()` in ChatMessage for reuse across user/assistant/sub-agent bubbles
- Refactor: extracted `buildToolResultMap()` as top-level utility in ChatView
- Fix: highlight dashed-border animation uses white stroke on user bubbles (blue background) for better visibility
- Fix: highlight now applies to all message roles, not just assistant
- Fix: SubAgent requests use their own timestamp for raw-chat view switching instead of searching for parent MainAgent
- Feat: added SubAgent call stats (by subType) in stats panel, below cache rebuild stats
- Refactor: cache rebuild stats extracted as independent column, inserted before tool usage stats
- Refactor: global settings changed from Modal to left-side Drawer; project stats Drawer also moved to left side

## 1.3.6 (2026-03-01)

- Feat: added "Original Text" section to all Tool-*.md docs (22 tools × 18 languages = 396 files), showing the raw Claude API tool description in a readonly textarea
- Added Tool-EnterWorktree.md documentation for all 18 languages (zh/ja/ko/en with localized content, others with English content + localized headings)
- Added textarea styling in ConceptHelp modal

## 1.3.5 (2026-03-01)

- Refactor: import modal simplified — flat file list replaces project-grouped collapse, with select-all and merge support; prevent merging the latest (active) log file
- Removed unused `/api/download-log` endpoint from server
- Fix: SubAgent tag display changed from `Tools:xxx` to `SubAgent:xxx` for clearer semantics
- Fix: textarea width overflow in User Prompt text mode (added box-sizing: border-box)
- Added i18n entry `ui.mergeLatestNotAllowed`

## 1.3.4 (2026-02-28)

- Feat: auto-update mechanism — checks npm registry on startup (every 4h), auto-updates within same major version, notifies for cross-major updates
- New `updater.js` module with version comparison, frequency control (`~/.claude/cc-viewer/update-check.json`), and `npm install -g` execution
- SSE events `update_completed` / `update_major_available` pushed to frontend
- AppHeader displays dismissible update notification tags (green for completed, orange for major)
- New API endpoint `GET /api/version-info`
- Added i18n entries for update notifications (18 languages)

## 1.3.3 (2026-02-28)

- Fix: Last Response in chat view now correctly correlates with the original request list, enabling proper scroll-to positioning when switching between raw and chat views
- Added session count (sessionCount) to project stats, tracking new conversation starts across JSONL log files
- Stats worker schema versioning (`STATS_VERSION`) to force cache invalidation when stats fields change

## 1.3.2 (2026-02-28)

- Refactor: consolidate all MainAgent detection logic into `contentFilter.js` (`isMainAgent()`) as the single source of truth, replacing scattered `req.mainAgent` checks across 6 files
- Added welcome guide page shown when no requests are loaded
- Added Tool-Agent concept docs for all 18 languages (Claude Code renamed Task → Agent)
- Updated interceptor mainAgent detection to support both `Task` and `Agent` tool names
- Added i18n entries for guide UI

## 1.3.1 (2026-02-28)

- Fix: include `stats-worker.js` in npm package files

## 1.3.0 (2026-02-28)

- Added Project Stats feature: background worker scans JSONL logs and generates per-project statistics including total requests, session file count, model usage with token breakdown (input/output/cache) and cache hit rates
- Added `/api/project-stats` and `/api/all-project-stats` API endpoints
- Refactored user content classification into shared `contentFilter.js` module (used by both ChatView and AppHeader)
- Fix: added missing `Spin` import in AppHeader causing "Spin is not defined" error

## 1.2.9 (2026-02-27)

- Fix: clicking request list item no longer causes unwanted scroll-to-bottom; only programmatic selection changes trigger scroll

## 1.2.8 (2026-02-27)

- Migrated `LOG_DIR` (`~/.claude/cc-viewer`) configuration to `findcc.js` for centralized path management, enabling easier adaptation for custom deployments
- Updated all 17 localized README files to sync with latest README.zh.md content

## 1.2.7 (2026-02-27)

- Updated all 17 localized README files to match README.zh.md as the source of truth
- Changed header logo from remote URL to local `/favicon.ico`
- Removed deprecated cc-viewer-translate skill file

## 1.2.6 (2026-02-26)

- Fix: clarify uninstall success message to indicate integration removal only
- Fix: enforce 1-hour limit for recent log detection
- Improved log list item layout to prevent wrapping
- Added `ccv --help` option support
- Added NPM version badge to README and all localized versions

## 1.2.5 (2026-02-26)

- Fix: Claude Code Native Install adaptation — improved `claude` binary detection with multi-strategy lookup (`which`, `command -v`, common install paths)
- Fix: `getNativeInstallPath` now filters out shell function output (multi-line results) to avoid false positives
- Fix: proxy hook now resolves `claude` command to its actual executable path, preventing shell function recursion
- Removed duplicate `execSync` import

## 1.2.4 (2026-02-26)

- Added Native Install support for Claude Code: auto-detects `claude` binary and configures proxy automatically
- Added Configuration Override support: respects `~/.claude/settings.json` and `ANTHROPIC_BASE_URL` env var
- Improved Request Body logging robustness: handles non-standard SSE formats and provides raw content fallback
- Silenced console logs in proxy mode to ensure clean CLI output
- Fixed `ZlibError` during response decompression
- Fixed connection refused issues by ensuring `ccv` background process stability

## 1.2.3 (2026-02-26)

- Fix: GLM streaming response body now correctly assembled (SSE `data:` format varies from Anthropic standard)
- Fix: SSE parser now handles both `data: {...}` and `data:{...}` formats for broader API compatibility

## 1.2.2 (2026-02-26)

- Fix: translate API no longer reuses OAuth session token (`authorization` header), preventing context pollution with Claude Code's main conversation
- Fix: translate API falls back to extracting `sk-` key from Bearer token when no `x-api-key` is available
- Fix: translate requests now bypass fetch interceptor via `x-cc-viewer-internal` header, eliminating log noise
- Fix: `_cachedModel` write guarded by `mainAgent` check, preventing SubAgent model overwrites
- Added `_cachedHaikuModel` for translate API model selection (captures haiku model from mainAgent requests, defaults to `claude-haiku-4-5-20251001`)
- Added `ccv --v` / `ccv --version` to display current version
- Added (?) help icon on `authorization` header in request detail panel, linking to TranslateContextPollution concept doc
- Fix: ConceptHelp (?) button click no longer triggers parent element expand/collapse (stopPropagation)
- Added TranslateContextPollution concept doc explaining OAuth token context pollution
- Included `concepts/` directory in npm package files

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
