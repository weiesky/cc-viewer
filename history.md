# Changelog

## 1.6.16 (2026-03-22)

- Feature: SubAgent requests now display KV-Cache-Text in network panel
- Fix: KV-Cache system prompt extraction now includes all cached blocks in the prefix (not only those with cache_control markers), matching Anthropic API prefix caching semantics
- Fix: AppHeader KV-Cache fallback path no longer picks teammate/SubAgent requests when multiple requests are present

## 1.6.15 (2026-03-22)

- Fix: MainAgent detection threshold lowered from >10 to >5 tools, compatible with v2.1.81+ lightweight MainAgent
- Fix: SubAgent incremental scan rewinds one entry to avoid misclassification when nextReq is missing
- Fix: AskUserQuestion prompt deduplication — active prompts matching Last Response question text are no longer displayed twice

## 1.6.14 (2026-03-21)

- Fix: KV-Cache system content display now only shows blocks that have `cache_control` themselves, filtering out non-cached metadata like `x-anthropic-billing-header`

## 1.6.13 (2026-03-21)

- Chore: bump version to 1.6.13

## 1.6.12 (2026-03-21)

- Feature: header displays country flag emoji based on network IP geolocation (via ipinfo.io); hover to see city, region, org, and IP; fallback to 🇨🇳 on request failure
- Feature: drag-and-drop file upload support
- Fix: full-chain real-time conversation refresh for main agent and teammates

## 1.6.11 (2026-03-20)

- Fix: full-chain real-time conversation refresh — teammate detection expanded to `--agent-name` (native team mode), metadata extraction no longer gated by `_isTeammate`
- Fix: teammate processes no longer trigger log rotation — only leader rotates
- Fix: `migrateConversationContext` truncates old file instead of deleting, preventing watcher `statSync` errors
- Fix: log-watcher truncation handler immediately checks `getLogFile()` for rotation and switches watcher
- Perf: `_reqScanCache` split into independent counters — `subAgentEntries` full-rescans on request changes without O(n²) on `tsToIndex`
- Perf: `appendToolResultMap` — hoist `split('\n')` out of loop to avoid O(L²)
- Perf: `isTeammate` WeakMap cache, `extractTeammateName` per-request cache

## 1.6.10 (2026-03-20)

- Feature: extract teammate name from SendMessage `tool_result` — `routing.sender` field provides reliable structured name, replacing fallback "X" display
- Fix: empty temp log files no longer renamed to permanent logs — empty files are deleted instead, preventing ghost sessions in file listing
- Fix: `migrateConversationContext` deletes empty old file after full migration instead of leaving 0-byte remnant
- Fix: server skips 0-byte log files in session listing API
- Fix: terminal cursor hidden to prevent stray blinking cursor in status bar area
- Fix: ChatView last response rendering cleanup
- Fix: AskQuestionForm — handle "Other" option from API natively, avoid duplicate "Other" entry; guard `questions` with `Array.isArray` check
- Fix: AskQuestionForm import path corrected to relative `../i18n`
- Fix: ptyChunkBuilder — remove extra Enter before typing text in "Other" input
- Fix: TerminalPanel cursor width restored to 1 for visibility
- Fix: resolveResumeChoice — always use new log path after rename
- Test: add teammate empty log filtering unit tests

## 1.6.8 (2026-03-19)

- Perf: `buildToolResultMap` — 4-pass full scan refactored to single-pass `appendToolResultMap` with WeakMap caching; historical sessions O(1), active session processes only new messages incrementally
- Perf: `buildAllItems` — 3 × O(n) full request scans merged into single incremental pass with instance-level cache (`tsToIndex`, `modelName`, `subAgentEntries`)
- Perf: `appendCacheLossMap` — cache loss analysis converted from full O(n) recompute to append-only incremental scan
- Perf: Last Response separated from `allItems` into independent state — main list updates are pure tail-appends, eliminating middle-insertion reflow during streaming
- Fix: SubAgent/Teammate requests not updating chat view when `mainAgentSessions` unchanged — added `requests` change detection in `componentDidUpdate`

## 1.6.6 (2026-03-19)

- Fix: guard null/undefined entries in `isRelevantRequest` — prevents `Cannot read properties of undefined (reading 'isHeartbeat')` crash during request filtering
- Fix: `selectedIndex` TDZ (Temporal Dead Zone) bug in `_flushPendingEntries` — variable was used before `let` declaration, causing `ReferenceError` when requests exceed 5000 cap, permanently freezing all state updates

## 1.6.0 (2026-03-18)

- Feature: Teammate display optimization — `Teammate: name(model)` format with dedicated team icon and per-name HSL color hashing
- Feature: AskQuestionForm extracted as standalone component — local state isolation eliminates parent re-render bottleneck during multi-select
- Feature: `ptyChunkBuilder.js` — pure functions for building PTY keystroke sequences (single/multi/other), separated from submission logic
- Feature: `writeToPtySequential()` server-side PTY write queue with per-chunk delay; `input-sequential` WebSocket message type
- Feature: multi-select PTY submission — → + Enter submit protocol, tab navigation for multi-question forms
- Feature: multi-question support — `_planSubmissionSteps()` annotates `isLast` flag; intermediate questions use → to switch tabs, last question uses → + Enter to submit
- Refactor: context window blood bar — cc-viewer no longer writes to `context-window.json`; reads `model.id` once at startup to cache 1M/200K size, computes usage from interceptor log
- Fix: Opus 4.6 1M context window detection — `readModelContextSize()` parses `[1m]` from `model.id`, `getContextSizeForModel()` maps API model names via cached base name
- Fix: `serverCachedContent` leak — `loadLocalLogFile()` clears stale server cache on local log switch
- Fix: removed `watchContextWindow` file polling — eliminates cross-process data pollution from teammates/other projects
- Docs: updated KVCacheContent concept docs across all 17 language versions

## 1.5.45 (2026-03-17)

- Fix: KV-Cache user prompt navigation — added SVG marching-ants dashed border animation on highlighted cache blocks (matching ChatMessage style)
- Fix: highlight timing — detect actual scroll completion via `scrollend` event + 500ms minimum delay, so animation appears after scroll settles instead of during
- Feature: raw mode cross-navigation — clicking user prompt nav in header popover now selects the MainAgent request, switches to KV-Cache-Text tab, and scrolls to the message with animation in DetailPanel
- Fix: DetailPanel performance — added `componentWillUnmount` timer cleanup, limited highlight state re-renders to kv-cache-text tab only, clear timers on request switch
- i18n: added `ui.userPromptNav` entries for all 18 supported languages, changed `ui.tokens` zh/zh-TW from "令牌" to "Token"

## 1.5.43 (2026-03-17)

- Fix: AskUserQuestion multi-question submit — replaced stale React state closure check with synchronous instance variable (`_currentPtyPrompt`) for reliable prompt detection across sequential question submissions

## 1.5.42 (2026-03-17)

- Feature: ultrathink button in PC terminal toolbar — writes `ultrathink ` command into terminal input without auto-submitting
- i18n: added `ui.terminal.ultrathink` entries for all 18 supported languages

## 1.5.41 (2026-03-17)

- Fix: AskUserQuestion single-select radio now clickable — replaced antd Radio.Group with custom div-based radio implementation
- Fix: AskUserQuestion interactive card renders in streaming "Last Response" — passes askAnswerMap, lastPendingAskId, onAskQuestionSubmit props
- Fix: CLI pre-answer detection — componentDidUpdate watches askAnswerMap changes to auto-replace interactive card with static answered card
- Fix: submit works without ptyPrompt — falls back to assuming first option selected (CLI default) when terminal prompt not detected
- Fix: mobile AskUserQuestion interactive — lazy WebSocket connect on submit, uses onAskQuestionSubmit gate instead of cliMode

## 1.5.40 (2026-03-16)

- Feature: log preview Popover — hover (desktop) or click (mobile) to see all user prompts in a floating panel
- Feature: mobile log table — timestamp hides year, shows `MM-DD HH:mm:ss` format
- Fix: preview column text overflow — maxWidth 600px with ellipsis for long prompts
- Fix: stats-worker prompt extraction rewritten to align with App.jsx/contentFilter.js logic (isSystemText, stripSystemTags, extractUserTexts)
- Fix: preview dedup — file-level Set dedup removes duplicate prompt text within same log file
- Fix: stats-worker STATS_VERSION 6→8, forces cache invalidation for re-parsing

## 1.5.39 (2026-03-16)

- Feature: AskUserQuestion interactive UI — pending questions render Radio/Checkbox controls with submit button in chat panel (single-select, multi-select, Other with text input, markdown preview layout)
- Fix: statusLine non-exclusive — no longer modifies user's `statusLine` in settings.json; context window data is now extracted from API response usage in the interceptor
- Fix: ExitPlanMode approval buttons now render immediately without waiting for PTY prompt detection; uses built-in default options as fallback
- i18n: added askSubmit, askSubmitting, askOther, askOtherPlaceholder entries for all 18 supported languages

## 1.5.37 (2026-03-16)

- Feature: plan approval UI — ExitPlanMode cards show approve/reject/feedback buttons with status badges; only the last pending card is interactive
- Feature: log table preview column — shows first user prompt from each conversation
- Feature: `/api/refresh-stats` endpoint — force re-scan all project stats with 30s timeout
- Feature: refresh stats button in import modal
- Fix: preview collection in stats-worker always-true condition — same-turn duplicate requests no longer produce duplicate previews
- Fix: plan feedback submission replaced fixed 300ms delay with polling (100ms intervals, max 2s) for reliable CLI mode detection
- i18n: added plan approval and refresh stats entries for all supported languages

## 1.5.34 (2026-03-15)

- Fix: chat panel repeatedly refreshing after restart — `watchLogFile()` now initializes `lastSize` to current file size instead of 0, preventing duplicate broadcast of historical entries already sent via `/events` load flow

## 1.5.32 (2026-03-14)

- Refactor: move proxy-errors.js and proxy-env.js into lib/ directory
- Fix: skip redundant interceptor setup when CCV_PROXY_MODE is set (prevents duplicate fetch patching in Claude subprocess)
- Chore: remove stale `locales/` entry from package.json files array

## 1.5.31 (2026-03-14)

- Feature: terminal toolbar with file upload button (PC only) — uploads file to server, writes quoted path to terminal/textarea
- Feature: upload button in chatInputBar when terminal is hidden
- Fix: SSE real-time updates broken after client disconnect (clients array reference was replaced instead of mutated in-place)
- Improve: upload API uses `apiUrl()` for token auth compatibility with LAN/QR access
- Improve: 50MB upload size limit enforced on both client and server
- Improve: unique filenames with timestamp suffix to prevent silent overwrite
- Add: test/upload-api.test.js (7 test cases)

## 1.5.30 (2026-03-14)

- Fix: QR code popover hardcoded 800px width — now auto-fits content

## 1.5.29 (2026-03-14)

- Feature: auto-refresh FileExplorer and GitChanges panels when Claude uses file-mutating tools (Write, Edit, Bash, NotebookEdit)
- Improve: footer bar top border for visual consistency with other toolbars
- Improve: unit test coverage from 68.98% → 71.23% line, 69.17% → 72.81% branch
- Add: test/git-diff.test.js, test/log-watcher.test.js, test/findcc.test.js, test/context-watcher.test.js
- Add: `npm run test:coverage` script for branch coverage reporting
- Improve: supplemented branch tests for proxy-errors, updater, stats-worker

## 1.5.27 (2026-03-13)

- Remove: inflight request detection and display (spinner, tooltip, popover) — feature no longer functional
- Fix: folder/git-changes sidebar buttons now toggle instead of always-open, and no longer close the file detail panel
- Fix: hardcoded `http://` protocol in process management port links and server URL parsing — now inherits from browser/server protocol

## 1.5.26 (2026-03-13)

- Feature: "当前项目" tag replaced with context usage health bar — shows real-time context window consumption with color transitions (green → yellow → red)
- Feature: statusLine integration — auto-installs wrapper script to capture `context_window.used_percentage` from Claude Code, pushed to frontend via SSE
- Feature: `getModelMaxTokens()` helper for model context window size mapping (Claude 200k, GPT-4o 128k, DeepSeek 128k, etc.)
- Fix: statusLine lifecycle — proper install/uninstall with original config preservation, cleanup on abnormal exit
- Fix: `ccv -uninstall` now cleans up statusLine config, ccv-statusline.sh script, and context-window.json
- Fix: `removeShellHook` now scans all shell config files (.zshrc, .zprofile, .bashrc, .bash_profile, .profile)

## 1.5.25 (2026-03-13)

- Feature: inject Claude process PID (`entry.pid`) into `onNewEntry` plugin hook — CLI mode uses PTY child PID, hook-injection mode uses `process.pid`
- Add: `getPtyPid()` export in pty-manager.js
- Improve: Context tab sidebar now supports keyboard navigation across visible items, including system prompt, history toggle, history turns, current turn, and tool entries
- Improve: Context sidebar interactive rows now use focusable controls with visible keyboard focus styling
- Note: auto-selecting the latest turn when `body/response` changes remains unchanged for now

## 1.5.24 (2026-03-13)

- Feature: "当前项目" tag replaced with context usage health bar — shows real-time context window consumption with color transitions (green → yellow → red)
- Feature: statusLine integration — auto-installs wrapper script to capture `context_window.used_percentage` from Claude Code, pushed to frontend via SSE
- Feature: `getModelMaxTokens()` helper for model context window size mapping (Claude 200k, GPT-4o 128k, DeepSeek 128k, etc.)
- Fix: statusLine lifecycle — proper install/uninstall with original config preservation, cleanup on abnormal exit
- Fix: `ccv -uninstall` now cleans up statusLine config, ccv-statusline.sh script, and context-window.json
- Fix: `removeShellHook` now scans all shell config files (.zshrc, .zprofile, .bashrc, .bash_profile, .profile)

## 1.5.23 (2026-03-13)

- Fix: `claude -v` / `claude --version` / `claude -h` no longer triggers ccv startup — passthrough flags now work correctly
- Fix: `installShellHook` now compares hook content instead of just mode, so outdated hooks are automatically replaced on `ccv -logger`

## 1.5.22 (2026-03-13)

- Feature: click file path in GitDiffView to open FileContentView and scroll to first changed line
- Fix: untracked files in Git Changes now show green "U" instead of raw "??"
- Enhancement: CodeMirror Find/Replace panel styled to match antd5 dark theme (no gradient, proper input/button sizing)
- Update: editor session banner text — clearer "click to return to Terminal" wording

## 1.5.21 (2026-03-13)

- Refactor: replace hardcoded HTTPS cert with plugin hook `httpsOptions` (waterfall)
- Enhancement: `serverStarted` hook now receives `{ port, host, url, ip, token }` (added `url`, `ip`, `token`)
- Fix: `/api/local-url` now respects actual server protocol (HTTP/HTTPS) instead of hardcoded `http://`
- Enhancement: AskUserQuestion renders selected answers with green checkmark SVG directly on assistant-side card
- Remove: separate user-selection bubble for AskUserQuestion (merged into assistant card)
- Fix: AskUserQuestion answer parsing — use regex instead of broken JSON.parse for `"q"="a"` format
- Enhancement: minimap overlay contrast and activeLine highlight improved

## 1.5.20 (2026-03-12)

- Fix: `proxy-errors.js` missing from npm package, causing `ERR_MODULE_NOT_FOUND` when running `ccv -logger`

## 1.5.19 (2026-03-12)

- Refactor: ccv argument passthrough — ccv is now a drop-in replacement for claude, all args passed through directly
- Remove: `-c`/`-d` flags as ccv-specific options (now passed through to claude as `--continue`/`--debug`)
- Add: `ccv -logger` command for hook installation (replaces bare `ccv`)
- Add: `--d` shortcut for `--dangerously-skip-permissions`
- Update: help text (`ccv -h`) now shows both ccv-specific and claude passthrough options
- Update: all 18 language README files to reflect new command format

## 1.5.18 (2026-03-11)

- Improve: compact JSON log format — remove pretty-print indentation to reduce log file size
- Improve: reduce MAX_LOG_SIZE from 200MB to 150MB
- Improve: add 300MB total size limit for log merge API

## 1.5.17 (2026-03-11)

- Fix: iOS terminal severe lag — skip WebGL renderer on iOS, fall back to Canvas rendering
- Fix: iOS keyboard pushes navigation bar out of viewport — use `visualViewport` API with fixed positioning to lock layout within visible area
- Improve: reduce terminal scrollback for better mobile performance (iOS: 200, Android: 1000, Desktop: 3000)
- Add `isIOS` device detection in env.js
- Add `interactive-widget=resizes-content` to viewport meta tag

## 1.5.16 (2026-03-11)

- Fix: single-line selection invisible in FileContentView editor — `.cm-activeLine` solid background occluded CodeMirror selection layer; changed to semi-transparent `rgba(255, 255, 255, 0.06)`

## 1.5.15 (2026-03-11)

- Fix: multi-line paste in terminal triggers auto-submit — intercept paste events with bracketed paste escape sequences (`\x1b[200~`...`\x1b[201~`) to prevent newlines from being treated as Enter
- Improve: skip bracketed paste wrapping when shell has already enabled bracketedPasteMode via `\x1b[?2004h`

## 1.5.14 (2026-03-11)

- Feat: built-in $EDITOR/$VISUAL intercept — Claude Code editor requests open in FileContentView, save and close to continue
- Feat: editor session management — server-side editorSessions Map with WebSocket broadcast for open/done events
- Improve: pty-manager passes serverPort, injects CCV_EDITOR_PORT env for ccv-editor.js script
- Improve: TerminalPanel handles editor-open messages, ChatView/FileContentView support editor session banner
- i18n: add ui.editorSession.banner across all 18 supported languages

## 1.5.12 (2026-03-10)

- Feat: CCV process management — list all CCV instances (port 7008-7099), view PID/port/command/start time, stop idle processes from UI
- Feat: process management API — GET /api/ccv-processes (discover via lsof, filter child processes) and POST /api/ccv-processes/kill (with safety checks)
- Improve: shell hook passthrough — non-interactive commands (--version, --help, plugin, mcp, etc.) bypass CCV interception entirely
- Improve: interceptor skip — non-interactive arguments skip interceptor setup and server startup for faster CLI responses
- Improve: PTY manager — switch to --settings JSON injection for ANTHROPIC_BASE_URL to reliably override settings.json config
- Fix: Modal.confirm dark theme — add global CSS overrides for antd confirm dialogs (background, text, button colors)
- Fix: DetailPanel reminder select — reduce CSS specificity from !important to doubled selector for cleaner overrides
- Fix: FileContentView minimap gutter — add padding-top alignment for line number column
- i18n: add ui.processManagement.* keys (12 entries) across all 18 supported languages

## 1.5.11 (2026-03-10)

- Feat: migrate FileContentView from highlight.js to CodeMirror 6 — full-featured code editor with syntax highlighting, editing, and save support
- Feat: add CodeMirror minimap extension — provides code overview with optimized settings (characters display, mouse-over overlay)
- Feat: file editing and saving — Ctrl+S hotkey support, auto-save status indicator, POST /api/file-content endpoint
- Improve: custom line number gutter — external line numbers with scroll sync, allowing minimap to display properly
- i18n: add ui.save, ui.saving, ui.saved, ui.saveFailed, ui.unsavedChanges across all 17 languages

## 1.5.10 (2026-03-09)

- Feat: mobile user prompt viewer — add "用户Prompt" menu item in mobile hamburger menu, fully aligned with PC's original mode implementation
- Feat: complete prompt extraction logic — replicate AppHeader's parseSegments, extractUserTexts, and extractUserPrompts methods for mobile
- Feat: export prompts to .txt — mobile version supports exporting user prompts with timestamps
- Improve: mobile chat list limit adjusted from 300 to 240 items for better performance

## 1.5.9 (2026-03-09)

- Fix: DiffView restructured from single table to fixed gutter + scrollable code layout — line numbers and +/- prefix no longer shift on mobile horizontal scroll
- Fix: DiffView code background colors (red/green) now extend to full row width — fills viewport when code is short, follows longest line when code overflows

## 1.5.8 (2026-03-09)

- Feat: mobile chat list performance optimization — limit rendering to last 300 items with "load more" button (loads 100 at a time), prevents UI lag with 500+ messages
- Feat: incremental SSE loading — client sends cached metadata (since/cc) to server, receives only delta entries instead of full reload
- Feat: auto-collapse long bash commands — bash commands with more than 5 lines are automatically collapsed in chat view to improve readability
- Improve: silent incremental updates — no loading overlay when cache exists, seamless merge of new data
- Improve: mobile "stick to bottom" button — 2x larger size (120px height, 24px font) for better touch targets
- i18n: add "ui.loadMoreHistory" with {count} placeholder across 17 languages
- i18n: add "ui.bashCommand" and "ui.lines" for bash command collapse feature

## 1.5.7 (2026-03-09)

- Fix: mobile virtual keyboard no longer pops up when pressing virtual keys (arrows, enter, etc.) — uses preventDefault on touchstart and blur after key send, while preserving normal text input focus

## 1.5.6 (2026-03-09)

- Fix: hide QR code entry in history log mode on PC
- Fix: DiffView toggle button (expand/collapse) no longer wraps on narrow screens
- Improve: DiffView code area supports unified horizontal scrolling — line numbers and +/- prefix columns use `position: sticky` with opaque backgrounds to stay fixed while code scrolls

## 1.5.5 (2026-03-09)

- Feat: download log file — new download button per log entry, streams raw JSONL via `/api/download-log`
- Feat: delete logs — bulk delete selected logs with confirmation dialog via `/api/delete-logs`
- Feat: log list upgraded from List to Table component with sortable columns (time, turns, size, actions)
- Feat: mobile display settings — collapseToolResults and expandThinking switches now accessible from mobile menu
- Improve: mobile log management — converted from Modal to left-slide-in panel, consistent with stats overlay
- Improve: mobile button styling — inactive buttons use gray outline, merge=blue/delete=red when active
- Fix: ConceptHelp modal — use ConfigProvider darkAlgorithm instead of manual color hacks; fixes black title and misaligned close button on mobile
- Fix: ConceptHelp horizontal scrollbar on mobile — add box-sizing:border-box to textarea/pre, overflow-x:hidden to modalBody
- Fix: PC log modal double scroll — changed Modal body to overflow:hidden to avoid conflict with Table scroll
- i18n: added downloadLog, deleteLogs, deleteLogsConfirm, deleteSuccess, deleteFailed, cancel, logTime, logSize, logTurns, logActions across all 18 languages

## 1.5.4 (2026-03-09)

- Fix: proxy stream error handler — add persistent error listener to prevent late-arriving errors from crashing the process
- Fix: outputBuffer safe truncation — skip incomplete ANSI escape sequences when slicing to prevent terminal state corruption on WebSocket replay
- Fix: local log file mode — pass access token when opening log files in new window; hide terminal button and show chat overlay for local log viewing on mobile
- Fix: ConceptHelp modal header and close button color set to white for better visibility
- Perf: ConceptHelp mobile responsive styles — adjusted font sizes for headings, code blocks, and textareas on small screens
- Perf: Terminal rendering optimization — add smoothScrollDuration:0 and scrollOnUserInput:true; chunk large writes (>32KB) across animation frames to prevent main thread blocking during /resume

## 1.5.3 (2026-03-08)

- Fix: Chat View Edit diff line numbers now correctly reflect file position by tracking Read results and Edit mutations via editSnapshotMap
- Fix: Read tool result `cat -n` format parsing — separator is `→` (Unicode 8594), not tab
- Fix: Git Diff minimap visibility race condition — use rAF polling to detect scrollHeight changes after content renders
- Fix: Git Diff minimap markers use CSS percentage positioning instead of pixel-based mapHeight to avoid zero-height state
- Improve: Chat View DiffView line number column width dynamically adjusts based on max line number

## 1.5.2 (2026-03-08)

- Fix: ConceptHelp modal dark theme — title, text, headings, code, links and close button now use light colors on dark background for mobile readability

## 1.5.1 (2026-03-08)

- Perf: reduce JSONL log rotation threshold from 300MB to 200MB
- Refactor: remove Body Diff JSON tooltip popup, keep diff functionality intact
- Perf: incremental SSE loading — client sends last timestamp and cached count, server returns only new entries

## 1.5.0 (2026-03-08)

- Feat: mobile IndexedDB entry cache — first load caches all entries, subsequent visits restore instantly from cache before SSE arrives
- Perf: singleton IndexedDB connection with write deduplication to avoid redundant structured clone on frequent SSE updates
- Feat: 7-day automatic cache expiry with cleanup on read
- Feat: mobile stats panel (MobileStats component)

---

## Pre-1.5 版本汇总 (Pre-1.5 Version Summary)

> 以下为 1.5.0 之前所有版本的功能摘要，详细变更记录已归档。
> Below is a condensed summary of all versions prior to 1.5.0.

### 1.4.x (2026-03-02 ~ 2026-03-07) — CLI 模式与终端集成

- CLI 模式 (`ccv -c`)：内置 PTY 终端直接运行 Claude，支持 npm/nvm 安装路径自动检测
- 分屏布局：终端 + 对话双面板，可拖拽调整比例
- 文件浏览器：树形目录、文件内容预览、minimap、支持 dot files 和 gitignore 灰显
- Git 集成：变更文件列表、统一 diff 视图（双行号）、diff minimap
- 工作区管理：多工作区切换、SSE 状态同步
- 插件系统：动态加载/卸载、启用/禁用状态管理
- 自动更新器：版本检测与自动升级
- 终端优化：WebGL 渲染 + context loss 恢复、Unicode11 CJK 支持、WebLinks、scrollback 扩容、PTY 输出批量合并
- SSE 分块加载：大日志文件分 50 条 chunk 传输，带进度指示
- 安全：LAN 移动端 token 鉴权修复
- 卸载命令 (`ccv --uninstall`)：完整清理 hooks 和配置

### 1.3.x (2026-02-28 ~ 2026-03-02) — 移动端适配与国际化

- 移动端响应式：虚拟按键栏、触摸滚动惯性、固定列宽自适应字号
- 国际化 (i18n)：支持 18 种语言（中/英/日/韩/法/德/西/葡/俄/阿/印/泰/越/土/意/荷/波/瑞典）
- 代理模式 (proxy)：拦截 Claude API 流量并记录
- 设置面板：主题、语言、显示选项等可视化配置
- 对话模式增强：thinking block 折叠/展开、工具调用结果渲染优化
- 安全：访问 token 认证、CORS 配置

### 1.2.x (2026-02-25 ~ 2026-02-27) — 对话模式

- Chat 模式：将原始 API 请求/响应重组为对话视图
- Markdown 渲染：代码高亮 (highlight.js)、表格、列表
- Thinking blocks：可折叠的模型思考过程展示
- 工具调用结果：结构化渲染 tool_use / tool_result
- 搜索功能：全文搜索对话内容
- 智能自动滚动：仅在用户位于底部时自动跟随

### 1.1.x (2026-02-25) — 数据统计面板

- Dashboard：请求统计、模型用量图表、token 消耗分析
- 缓存重建分析：按原因分类统计（TTL、system/tools/model 变更、消息截断/修改）

### 1.0.x (2026-02-24 ~ 2026-02-25) — 请求查看器

- Request/Response 详情查看器：原始请求体、响应体、流式组装
- 缓存重建分析：精确识别 system prompt / tools / model 变更原因
- Body Diff：JSON/Text 视图切换、复制按钮
- 双向模式同步：Chat ↔ Raw 模式跳转定位
- Claude Code 工具参考文档（22 个内置工具）

### 0.0.1 (2026-02-17) — 初始版本

- 拦截并记录 Claude API 请求/响应

