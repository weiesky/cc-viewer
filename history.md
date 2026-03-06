# Changelog

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

## 1.4.11 (2026-03-03)

- Feat: mobile-friendly UI with responsive layout for small screens (≤768px width)
- Feat: mobile chat browse — slide-in overlay shows full conversation history on mobile
- Feat: mobile terminal — touch-friendly PTY with on-screen keyboard toggle
- Feat: slide-in panels — detail panel and chat view now slide in from right on both desktop and mobile
- Feat: chat-view-to-terminal sync — switching to terminal from chat view preserves scroll position on return
- Feat: "Open in VSCode" button in file explorer header and context menu
- UI: file explorer header redesign with cleaner action button layout
- Fix: file explorer no longer steals focus from terminal when loading more content

## 1.4.10 (2026-03-02)

- Feat: conversation mode — parse Main Agent conversation into chat bubbles, toggle via button in header
- Feat: thinking block translation — one-click translate thinking content to UI language
- Feat: thinking block expand/collapse — collapsed by default with chevron indicator
- Feat: tool result collapse setting — new option to collapse tool results by default
- UI: improved ChatView styling and layout

## 1.4.9 (2026-03-02)

- Feat: cache rebuild reasons in stats panel — track why prompts need cache rebuild (TTL, tools, system, truncation, key change)
- UI: improved stats panel layout with grouped sections
- Fix: cache hit rate calculation now excludes requests with no cacheable tokens

## 1.4.8 (2026-03-02)

- Feat: file explorer panel — browse project files with directory tree and syntax highlighting
- Feat: git changes panel — view modified files and diffs directly in the UI
- Feat: git diff viewer — syntax-highlighted diff display with line numbers
- Fix: Windows compatibility for file path handling

## 1.4.7 (2026-03-02)

- Feat: `ccv -c` CLI mode — run Claude in PTY with auto-open browser and integrated terminal
- Feat: `ccv -d` dangerous mode — CLI mode with `--dangerously-skip-permissions`
- Feat: integrated terminal — xterm.js terminal panel in desktop layout
- Feat: QR code for mobile access — scan to open viewer on phone

## 1.4.6 (2026-03-01)

- Feat: `ccv run -- <command>` — run any command with CC-Viewer proxy active
- Feat: proxy mode — standalone proxy for SDK integration (`ccv proxy`)
- Feat: Python SDK — `cc_viewer_sdk` package for Claude Agent SDK integration

## 1.4.5 (2026-02-28)

- Feat: project selection in log import modal — dropdown to switch between projects
- Fix: log list now refreshes on modal open (cache-busting query param)
- UI: improved log import modal layout

## 1.4.4 (2026-03-02)

- Added SDK Integration for Claude Agent SDK (Python)
  - New `ccv proxy` subcommand for standalone proxy mode
  - New `cc_viewer_sdk` Python package with `enable_cc_viewer()` function
  - Monkey-patch SDK's `_build_command` to inject `--settings` parameter
  - Remote access support via `remote=True` parameter
  - Full documentation in `sdk-hooks/python/README.md`

## 1.4.0 (2026-03-02)

- Initial SDK integration release
  - `ccv proxy` command for standalone proxy mode
  - Python SDK with `enable_cc_viewer()` and `disable_cc_viewer()`
  - Environment variable support for custom ccv path (`CC_VIEWER_PATH`)
  - Remote access via `CC_VIEWER_HOST` environment variable

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
