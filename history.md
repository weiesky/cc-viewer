# Changelog

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

## 1.4.32 (2026-03-07)

- Feat: git changes file list now highlights the selected file, matching file explorer's hover and selected state style

## 1.4.31 (2026-03-07)

- Feat: FullFileDiffView unified diff — dual line numbers (old | new), deleted lines shown inline with strikethrough instead of tooltip
- Feat: diff minimap — 10px color-coded change indicator on scrollbar right side, click to navigate, auto-hidden when content fits in viewport
- Perf: SSE chunked loading — server sends large log files in 50-entry chunks with progress events instead of single full_reload
- Feat: client-side chunked loading progress indicator during initial data load

## 1.4.30 (2026-03-07)

- Perf: increase scrollback buffer (mobile 500→2000, desktop 1000→5000) for long Claude sessions
- Feat: enable WebLinksAddon — URLs in terminal output are now clickable
- Perf: ResizeObserver debounce (150ms) to reduce excessive fit/resize calls during window drag
- Fix: call terminal.reset() before WebSocket reconnect to prevent duplicate content from replayed history buffer
- Perf: server-side PTY output batching via setImmediate — merges multiple onData events per I/O cycle into a single WebSocket message
- Fix: WebGL context loss recovery — auto-retry once after 1s instead of permanent Canvas fallback
- Feat: Unicode11 Addon for correct CJK character width — fixes cursor misalignment and column rendering for Chinese/Japanese/Korean text
- Chore: move @xterm/addon-web-links from dependencies to devDependencies (bundled by Vite)

## 1.4.29 (2026-03-07)

- Fix: conversation area not refreshing after workspace switch due to race condition between SSE full_reload animation and HTTP response callback
- Fix: send full_reload SSE event after workspace launch so client receives the new workspace's log data
- Fix: cancel stale animateLoadingCount timer on workspace switch to prevent old callback from overwriting new data
- Fix: updater tests failing when ~/.claude/settings.json has autoUpdates disabled — now mock settings file in tests
- Test: add test case for settings.json-based auto-update disabling

## 1.4.28 (2026-03-06)

- Feat: move "Workspaces" button from header bar into dropdown menu as "Switch Workspace", shown only in CLI mode
- Feat: file explorer now shows dot files (`.gitignore`, `.env`, etc.) instead of hiding all files starting with `.`
- Feat: file explorer now shows `node_modules`, `dist`, `__pycache__` etc. instead of hard-filtering them; gitignored files/dirs are grayed out via `git check-ignore`
- Feat: file explorer and git changes file viewers are now mutually exclusive — opening one closes the other
- Feat: increase QR code size from 160px to 200px for easier mobile scanning
- Chore: remove LAN address printing on server startup
- Test: update and add unit tests for new `/api/files` behavior (IGNORED_PATTERNS, dot files, gitIgnored flag)

## 1.4.26 (2026-03-06)

- Test: add comprehensive unit tests for `ccv --uninstall` functionality covering npm mode, native mode, multiple hooks, and user config preservation

## 1.4.25 (2026-03-06)

- Fix: syntax error in commented code block causing server startup failure

## 1.4.24 (2026-03-06)

- Chore: temporarily disable chokidar file watcher feature

## 1.4.23 (2026-03-06)

- Fix: file content view minimap now uses viewport height as reference when content fits in one screen, preventing content from being stretched across entire scroll area

## 1.4.22 (2026-03-06)

- Fix: plugin enable/disable state now correctly displayed in UI when plugin defines custom `name` property different from filename
- Feat: `ccv -c` mode now prioritizes npm-installed claude (including nvm installations), falling back to native binary if not found
- Feat: added `resolveNpmClaudePath()` to detect and use npm/nvm-installed claude in CLI mode
- Fix: `pty-manager.js` now supports launching npm-installed claude via `node cli.js` instead of binary

## 1.4.21 (2026-03-06)

- Fix: LAN mobile access — all API fetch and SSE EventSource requests now carry the access token, fixing 403 errors that caused empty chat view on mobile devices

## 1.4.20 (2026-03-05)

- Fix: `resolveNativePath()` now excludes npm symlinks pointing to `node_modules`, correctly resolving native claude binary
- Fix: chokidar file watcher no longer starts before PTY is running, preventing `EMFILE: too many open files` crash
- Fix: chokidar error events now handled gracefully instead of crashing the process
- Fix: chokidar ignores hidden directories (`.*`) to avoid permission errors on system dirs
- Fix: `lib/updater.js` package.json path corrected after file relocation to `lib/`
- Feat: added unit tests for `cli.js`, `lib/plugin-loader.js`, `lib/updater.js`, `lib/stats-worker.js`, `pty-manager.js`, and `server.js` IGNORED_PATTERNS

## 1.4.19 (2026-03-05)

- Fix: include `workspace-registry.js` in npm package files

## 1.4.18 (2026-03-05)

- Fix: duplicate request entries in log — in-flight requests now marked with `inProgress: true`, removed on completion to preserve original payload
- Fix: filter out in-flight requests and legacy status-0 entries from request list

## 1.4.17 (2026-03-05)

- Refactor: MainAgent detection logic consolidated into dedicated functions
- Feat: support Claude Code v2.1.69+ new architecture detection (ToolSearch + deferred tools)
- Refactor: `interceptor.js` now uses `isMainAgentRequest()` for consistent MainAgent marking
- Refactor: `contentFilter.js` enhanced with new architecture detection for accurate filtering
- Fix: MainAgent detection now correctly identifies both old and new Claude Code architectures

## 1.4.16 (2026-03-04)

- Feat: plugin system — load/unload/enable/disable plugins from `~/.claude/logs/plugins/` directory
- Feat: plugin management UI — add, delete, toggle, reload plugins from settings panel
- Feat: plugin hooks support (waterfall & parallel) for extensibility
- Fix: plugin delete confirm dialog now uses antd Modal with dark theme (was white due to static Modal.confirm)
- Fix: server.js syntax error — missing closing brace in handleRequest caused `Unexpected token 'export'`

## 1.4.15 (2026-03-04)

- Fix: mobile terminal always uses 60-col fixed width with auto-scaled font size to fit screen
- Fix: mobile-priority PTY sizing — when mobile is connected, PTY locks to mobile dimensions; PC displays narrower output but renders correctly
- Fix: CLI mode QR code not showing due to race condition — `CCV_CLI_MODE` env now set before `import('./proxy.js')` to prevent stale module-level const

## 1.4.14 (2026-03-04)

- Fix: shared PTY multi-client rendering corruption — only the active client (last to send input) controls PTY size, preventing PC/mobile resize conflicts

## 1.4.13 (2026-03-04)

- Feat: FileExplorer selected file highlight — active file shows background matching hover state
- Feat: FileExplorer remembers folder expanded state when panel is closed and reopened
- UI: folder expand arrow changed from text triangles (▸/▾) to SVG chevron with rotation animation
- Feat: Git Changes tree view — files displayed in directory hierarchy instead of flat list (desktop & mobile)
- Feat: terminal auto-focus on page load in CLI mode
- Feat: sub-agent avatars differentiated by type (search/explore, plan, default)
- UI: "Live Monitoring" label renamed to "Project" across all i18n languages
- UI: snap lines reduced to show only the closest one during terminal resize drag
- Fix: git diff commands hardened with `--` separator and suppressed stderr via stdio pipes
- Fix: skip binary file check for deleted files in git diff API

## 1.4.12 (2026-03-03)

- Perf: WebGL renderer for terminal — GPU-accelerated character drawing with automatic Canvas fallback
- Perf: terminal output throttle — batch high-frequency writes via requestAnimationFrame to reduce render overhead

## 1.4.11 (2026-03-03)

- Refactor: split panel layout — FileExplorer/GitChanges decoupled from chat section, terminal uses fixed pixel width instead of flex ratio
- Feat: snap lines now only show the 2 closest to current position during drag
- Feat: mobile Git Diff preview — slide-in panel with file list (300px) + diff viewer from left side
- Fix: mobile terminal rendering stability — use fixed cols/rows based on screen size instead of dynamic fitAddon
- Refactor: QR code module migrated from settings drawer to header nav bar as hover popover (phone icon)
- Refactor: "Display Settings" moved to CC-Viewer dropdown menu, drawer slides from left
- Refactor: "Global Settings" menu item only visible in raw (network) mode
- UI: Git nav icon replaced with new SVG design
- Fix: code detail view vertical scroll broken after layout refactor
- Refactor: FileContentView two-column layout — line numbers fixed on left, code scrolls independently
- Refactor: FullFileDiffView two-column layout — line numbers and diff indicators fixed, code block scrolls as a whole
- Fix: diff highlight border moved to line number column (border-right) so it stays fixed during horizontal scroll

## 1.4.10 (2026-03-03)

- Fix: concept help docs (?) links broken — `/api/concept` route lost query params after URL parsing refactor
- Feat: split panel snap-to-columns — drag resizer snaps to 60/80/100/120 terminal column widths with visual guides
- Feat: split ratio persistence — user's preferred panel ratio saved to localStorage
- Security: `/api/local-log` hardened with `.jsonl` file type check and `realpathSync` path traversal prevention
- Improve: `/api/local-log` route uses `parsedUrl.searchParams` consistent with other routes
- UI: robust error handling for local log file loading with content-type validation

## 1.4.9 (2026-03-03)

- Feat: Git Changes panel — displays modified/added/deleted files in left sidebar
- Feat: Git diff viewer — click file in Git Changes to view full-file diff with context
- Feat: full-file diff view — shows complete file content with highlighted change lines
- Feat: change line markers — green for additions, orange for modifications, red for deletions
- Feat: hover to view old content — modified lines show original text on hover with strikethrough
- Feat: diff statistics — displays +N additions, ~N modifications, -N deletions at top
- Feat: syntax highlighting in diff view — supports 20+ languages with highlight.js
- Feat: deleted file support — shows original content with all lines marked as deleted
- Feat: new file support — shows all lines marked as added
- API: `/api/git-diff` endpoint — fetches diff data for specified files with binary/large file detection
- UI: FileExplorer and GitChanges panels — mutually exclusive, only one visible at a time
- i18n: added `ui.loadingDiff`, `ui.binaryFileNotice`, `ui.largeFileWarning`, `ui.openInEditor`, `ui.fileSize` entries for all 18 languages

## 1.4.8 (2026-03-03)

- Feat: smart line-level DiffView — uses `diff` library (Myers algorithm) for accurate line-level diffing
- Feat: DiffView now shows dual line numbers (old/new), context lines in gray, deletions in red, additions in green
- Feat: DiffView displays `+N -M` change summary in header
- Feat: DiffView resolves real file line numbers from prior Read results in the same conversation
- Refactor: DiffView migrated from global CSS to CSS Modules with monospace table layout
- UI: mobile chat zoom reduced from 0.7 to 0.6 for better fit on small screens
- i18n: added `ui.diffSummary` entry for all 18 languages

## 1.4.7 (2026-03-03)

- UI: language selector moved from AppHeader right side to CC-Viewer dropdown as submenu
- UI: display settings button changed from custom span to Ant Design Button for consistent height
- UI: QR code section only renders in CLI mode, with title "Scan to Code" and copy-able URL input
- UI: settings drawer items grouped in bordered card with "Chat Display Switches" title
- UI: settings drawer width increased from 320px to 360px
- Feat: `ccv -c` shorthand for `ccv --c` CLI mode
- Feat: `ccv -d` launches CLI mode with `claude --dangerously-skip-permissions`
- i18n: added languageSettings, scanToCoding, copied, chatDisplaySwitches entries for all 18 languages
- UI: sticky bottom button redesigned — borderless, text-over-arrow layout, semi-transparent pill background on label

## 1.4.6 (2026-03-03)

- Fix: Native mode shell hook now passthrough non-API commands directly without ccv interception
- Added passthrough list for subcommands: `doctor`, `install`, `update`, `upgrade`, `auth`, `setup-token`, `agents`, `plugin`, `mcp`
- Added passthrough list for flags: `--version`, `-v`, `--v`, `--help`, `-h`
- These commands don't involve API calls and don't need proxy/logging
- Feat: mobile chat browse — read-only chat view accessible from mobile CLI mode via slide-in overlay
- Feat: chat overlay slides in from right with CSS transition animation
- Fix: Ant Design dark theme applied to mobile chat overlay (thinking labels, collapse components)
- Fix: chat scroll working correctly in mobile overlay with proper flex layout chain
- UI: mobile chat view scaled to 70% zoom for better readability on small screens
- UI: hide "view request" button in mobile chat mode (read-only browsing)
- i18n: added `mobileChatBrowse` / `mobileChatExit` entries for all 17 languages

## 1.4.5 (2026-03-03)

- Feat: LAN access with token-based security — server listens on 0.0.0.0 with random token for non-localhost requests
- Feat: token interceptor — auto-attaches URL token to all fetch/EventSource/WebSocket requests from mobile
- Fix: WebSocket terminal input broken after token interceptor replaced WebSocket constructor without preserving static constants (OPEN/CLOSED)
- Fix: WebSocket upgrade requests intercepted by handleRequest returning HTML instead of 101 handshake
- Fix: port probe before binding 0.0.0.0 to avoid conflict with existing 127.0.0.1 listeners
- Static assets (JS/CSS/favicon) exempt from token validation

## 1.4.4 (2026-03-02)

- Feat: QR code in Display Settings drawer — scan to access cc-viewer from mobile on LAN
- Feat: `/api/local-url` endpoint returns local network IP and port
- UI: rename "Settings" to "Display Settings" with i18n updates

## 1.4.3 (2026-03-02)

- Feat: mobile CLI mode — full-screen terminal with status bar showing live monitoring project name
- Feat: mobile virtual keybar — ↑ ↓ ← → Enter Tab Esc Ctrl+C buttons for terminal interaction
- Fix: inflight request timeout — requests without response older than 5 minutes no longer shown as in-flight
- UI: remove guide icon from empty state in raw view mode
- UI: add star request text in footer with i18n support

## 1.4.2 (2026-03-02)

- Fix: prevent redundant cc-viewer server startup when Claude Code is launched via `ccv --c` or `ccv run` proxy mode (CCV_PROXY_MODE env guard)
- Fix: read `ANTHROPIC_BASE_URL` from project-level config files (`.claude/settings.local.json`, `.claude/settings.json`) with correct priority order (#13)

## 1.4.1 (2026-03-02)

- Feat: Context Tab v2 — merged from PR #11, turn-based conversation view with collapsible history turns and current turn auto-selection
- Build: rebuild dist with latest source changes

## 1.4.0 (2026-03-02)

- Feat: CLI mode — embedded PTY terminal panel with split-pane layout, WebSocket-based input/output
- Feat: PTY permission prompt detection — terminal prompts rendered as interactive chat bubbles with clickable options
- Feat: PTY prompt history — answered prompts stay in chat (greyed out with selected option highlighted), dismissed prompts auto-fade
- Feat: last response suggestion ghost text — assistant's final response pre-fills chat input as grey placeholder; Tab to accept, type to dismiss
- Feat: terminal-visible suggestion chip — when terminal panel is open, suggestion appears as clickable bar that sends to PTY
- Feat: sticky-to-bottom auto-restore — scrolling within 5px of bottom automatically re-enables sticky mode
- Feat: hide terminal button in raw (network) view mode
- Fix: raw-to-chat scroll positioning — switching from raw mode with a selected request now correctly scrolls to the corresponding chat message
- i18n: added `ui.chatInput.hintTab` entry for all supported languages

## 1.3.9 (2026-03-02)

- Feat: Context Tab — turn-based conversation view with history collapsing and current turn auto-selection
- Feat: Context Tab — response inheritance: last turn's assistant blocks overridden with actual API response content
- Feat: Context Tab — timestamps (HH:MM:SS) shown in sidebar items and content area role headers
- Feat: Context Tab — thinking blocks (collapsible), tool_use/tool_result blocks with JSON viewer, per-block translation
- Feat: Context Tab — system blocks and tools section rendered with block-level components
- Feat: Language selector shows full language name instead of short code
- Fix: removed "View in conversation" button from Context tab bar extra content
- Chore: add .idea/ to .gitignore

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
