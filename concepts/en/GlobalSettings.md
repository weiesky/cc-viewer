# CC-Viewer Configuration Reference

## 1. Global Settings Panel (UI)

Open via top-left menu → "Global Settings".

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| Filter Irrelevant Requests | Switch | On | Hide heartbeat, count_tokens, sub-agent and other non-main-agent requests |
| Expand Body Diff JSON | Switch | Off | Expand Body Diff section by default in request detail panel |
| Log Directory | Text Input | `~/.claude/cc-viewer` | Root directory for project log read/write. Supports `~/` expansion. Takes effect immediately on Enter or blur |

## 2. Display Settings Panel (UI)

Open via top-left menu → "Display Settings".

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| Collapse Tool Results | Switch | On | Collapse tool call result blocks in chat view |
| Expand Thinking | Switch | On | Expand Claude's thinking/reasoning blocks by default |
| Show Full Tool Content | Switch | Off | Show full untruncated tool call content |
| Auto Resume Session | Switch + Options | Off | Automatically choose when session resume prompt appears: `Continue` or `New` |

## 3. Preferences File

All UI settings are persisted to `<log_dir>/preferences.json` via the `/api/preferences` API.

```json
{
  "lang": "en",
  "filterIrrelevant": true,
  "expandDiff": false,
  "collapseToolResults": true,
  "expandThinking": true,
  "showFullToolContent": false,
  "logDir": "~/.claude/cc-viewer",
  "resumeAutoChoice": null,
  "disabledPlugins": [],
  "presetShortcuts": []
}
```

| Field | Type | Description |
|-------|------|-------------|
| `lang` | string | UI language (zh/en/zh-TW/ko/ja/de/es/fr/it/da/pl/ru/ar/no/pt-BR/th/tr/uk) |
| `filterIrrelevant` | boolean | Filter irrelevant requests |
| `expandDiff` | boolean | Expand Body Diff JSON by default |
| `collapseToolResults` | boolean | Collapse tool results |
| `expandThinking` | boolean | Expand thinking blocks |
| `showFullToolContent` | boolean | Show full content |
| `logDir` | string | Log directory path |
| `resumeAutoChoice` | null / "continue" / "new" | Auto resume session choice |
| `disabledPlugins` | string[] | Disabled plugin filenames |
| `presetShortcuts` | array | Agent Team preset shortcuts |

## 4. Environment Variables

### CC-Viewer Specific

| Variable | Default | Description |
|----------|---------|-------------|
| `CCV_LOG_DIR` | `~/.claude/cc-viewer` | Log storage root directory. Special values: `tmp`/`temp` use system temp dir |
| `CCV_CLI_MODE` | unset | `=1` enables CLI mode (PTY terminal) |
| `CCV_SDK_MODE` | unset | `=1` enables Agent SDK mode (no terminal) |
| `CCV_WORKSPACE_MODE` | unset | `=1` enables workspace selection mode |
| `CCV_PROJECT_DIR` | `process.cwd()` | Project working directory for file operations and Git commands |
| `CCV_PROXY_PORT` | unset | Local MITM proxy port |
| `CCV_BYPASS_PERMISSIONS` | unset | `=1` skip tool permission approval (with `--dangerously-skip-permissions`) |
| `CCV_DISABLE_DELTA` | unset | `=1` disable incremental log storage, write full messages every time |
| `CCV_DEBUG` | unset | `=1` enable HTTP proxy debug logging |
| `CCV_DEBUG_PLUGINS` | unset | `=1` enable plugin loading debug logging |

### Internal IPC

| Variable | Description |
|----------|-------------|
| `CCVIEWER_PORT` | Server port for ask-bridge/perm-bridge communication |
| `CCV_EDITOR_PORT` | Server port for ccv-editor file editing bridge |

### External (Read-only)

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_BASE_URL` | Custom Anthropic API address |
| `SHELL` | User's shell (PTY spawn and shell config detection) |
| `http_proxy` / `HTTPS_PROXY` etc. | HTTP proxy config (via undici EnvHttpProxyAgent) |

## 5. CLI Arguments

```
ccv [options] [claude args...]
```

### CC-Viewer Options

| Argument | Description |
|----------|-------------|
| `-logger` | Install/repair Claude Code hooks |
| `--uninstall` / `-uninstall` | Remove all CC-Viewer integration |
| `--help` / `-h` / `help` | Show help text |
| `--version` / `-v` | Show version |
| `-SDK` / `--sdk` | Use Agent SDK mode |
| `--d` | Shortcut for `--dangerously-skip-permissions` |
| `--ad` | Shortcut for `--allow-dangerously-skip-permissions` |
| `run` | Run command through proxy (`ccv run -- claude ...`) |

### Claude Pass-through (common)

| Argument | Description |
|----------|-------------|
| `-c` / `--continue` | Continue last session |
| `-r` / `--resume` | Resume specific session |
| `-p` / `--print` | Non-interactive output |
| `--model` | Specify model |
| `--permission-mode` | Permission mode |
| `--system-prompt` | Custom system prompt |
| `--max-budget-usd` | Maximum budget |

## 6. Hook Configuration

CC-Viewer auto-registers hooks in `~/.claude/settings.json` under `hooks.PreToolUse`:

### 1. AskUserQuestion Bridge
- **Matcher**: `"AskUserQuestion"`
- **Command**: `node <install_dir>/lib/ask-bridge.js`
- **Purpose**: Forward Claude's questions to Web UI, wait for user answers

### 2. Permission Approval Bridge
- **Matcher**: `""` (empty = match all tools)
- **Command**: `node <install_dir>/lib/perm-bridge.js`
- **Purpose**: Only `Bash`/`Edit`/`Write`/`NotebookEdit` require Web UI approval; others pass through

## 7. Shell Integration

CC-Viewer injects a `claude()` function into `~/.zshrc` (or `.bashrc`):

```bash
# >>> CC-Viewer Auto-Inject >>>
claude() { ... }
# <<< CC-Viewer Auto-Inject <<<
```

All `claude` commands are automatically routed through CC-Viewer proxy for log capture and Web UI features.

Uninstall: `ccv --uninstall` or manually delete content between the markers.

## 8. Proxy Configuration (Proxy Profile)

Stored in `<log_dir>/profile.json`, managed via the "Proxy Switch" panel in the UI.

```json
{
  "active": "max",
  "profiles": [
    { "id": "max", "name": "Default" },
    { "id": "my-proxy", "name": "Custom", "baseURL": "https://...", "apiKey": "sk-..." }
  ]
}
```

| Field | Description |
|-------|-------------|
| `active` | Active profile ID (`"max"` = direct connection, no proxy) |
| `id` | Unique identifier |
| `name` | Display name |
| `baseURL` | Proxy API address (replaces request origin) |
| `apiKey` | Proxy API key (replaces auth headers) |
| `models` | Available model list |
| `activeModel` | Currently selected model |

## 9. Plugin System

Plugin directory: `<log_dir>/plugins/`

### Supported Hook Types

| Hook | Type | Description |
|------|------|-------------|
| `httpsOptions` | Waterfall | Provide HTTPS certificate (return `{ cert, key }` or `{ pfx }`) |
| `localUrl` | Waterfall | Modify local access URL |
| `serverStarted` | Parallel | Server startup notification |
| `serverStopping` | Parallel | Server shutdown notification |
| `onNewEntry` | Parallel | New log entry written notification |

Plugin enable/disable managed via `disabledPlugins` array in `preferences.json`.

## 10. Directory Structure

```
~/.claude/cc-viewer/               # Log root directory
├── preferences.json               # User preferences
├── workspaces.json                # Workspace registry
├── profile.json                   # Proxy configuration
├── plugins/                       # Plugin directory
│   └── my-plugin.js
├── <project>/                     # Per-project log directory
│   ├── <project>_20260404_123456.jsonl  # JSONL log files
│   ├── <project>.json             # Stats data (background generated)
│   └── images/                    # Persistent uploaded image copies
└── ...

/tmp/cc-viewer-uploads/            # Temporary upload file directory
```

## 11. Server Configuration

| Setting | Value | Description |
|---------|-------|-------------|
| Port range | 7008-7099 | Auto-scans for available port |
| Bind address | 0.0.0.0 | All network interfaces |
| Access token | Random 16-byte hex | LAN access requires `?token=xxx`; localhost is exempt |
| HTTPS | Plugin only | Requires plugin providing `httpsOptions` hook |
| CORS | `*` | All origins allowed |
| Upload limit | 50MB | Maximum single file upload size |

## 12. URL Parameters

| Parameter | Description |
|-----------|-------------|
| `?token=xxx` | LAN access authentication token |
| `?logfile=path` | Open specific historical log file (read-only mode) |

## 13. localStorage Settings

| Key | Description |
|-----|-------------|
| `ccv_cacheExpireAt` | Cache countdown expiration time |
| `ccv_cacheType` | Cache type label |
| `ccv_sseSlim` | Enable SSE incremental pruning (desktop performance optimization) |
| `ccv_calibrationModel` | KV-Cache context window calibration model |
| `ccv_fileExplorerOpen` | File explorer panel toggle |
| `cc-viewer-terminal-width` | Terminal panel width (pixels) |
