# CC-Viewer

A request monitoring system for Claude Code that captures and visualizes all API requests and responses in real time. Helps developers monitor their Context for reviewing and debugging during Vibe Coding.

[简体中文](./docs/README.zh.md) | [繁體中文](./docs/README.zh-TW.md) | [한국어](./docs/README.ko.md) | [日本語](./docs/README.ja.md) | [Deutsch](./docs/README.de.md) | [Español](./docs/README.es.md) | [Français](./docs/README.fr.md) | [Italiano](./docs/README.it.md) | [Dansk](./docs/README.da.md) | [Polski](./docs/README.pl.md) | [Русский](./docs/README.ru.md) | [العربية](./docs/README.ar.md) | [Norsk](./docs/README.no.md) | [Português (Brasil)](./docs/README.pt-BR.md) | [ไทย](./docs/README.th.md) | [Türkçe](./docs/README.tr.md) | [Українська](./docs/README.uk.md)

## Usage

### Installation

```bash
npm install -g cc-viewer
```

### Run & Auto-Configuration

```bash
ccv
```

This command automatically detects your Claude Code installation method (NPM or Native Install) and configures itself.

- **NPM Install**: Injects interceptor script into `cli.js` of Claude Code.
- **Native Install**: Detects `claude` binary, sets up a local transparent proxy, and configures a Zsh Shell Hook to route traffic through the proxy automatically.

### Configuration Override

If you need to use a custom API endpoint (e.g., corporate proxy), simply configure it in `~/.claude/settings.json` or set `ANTHROPIC_BASE_URL` environment variable. `ccv` will respect these settings and forward requests correctly.

### Silent Mode

By default, `ccv` runs in silent mode when wrapping `claude`, ensuring your terminal output remains clean and identical to the original Claude Code experience. All logs are captured in the background and visible at `http://localhost:7008`.

Once configured, use `claude` as usual. Open `http://localhost:7008` to view the monitoring interface.

### Troubleshooting

- **Mixed Output**: If you see `[CC-Viewer]` debug logs mixed with Claude's output, please update to the latest version (`npm install -g cc-viewer`).
- **Connection Refused**: Ensure `ccv` background process is running. Running `ccv` or `claude` (after hook installation) should start it automatically.
- **Empty Body**: If you see "No Body" in the viewer, it might be due to non-standard SSE formats. The viewer now attempts to capture raw content as a fallback.

### Uninstall

```bash
ccv --uninstall
```

## Features

### Request Monitoring (Raw Mode)

- Real-time capture of all API requests from Claude Code, including streaming responses
- Left panel shows request method, URL, duration, and status code
- Automatically identifies and labels Main Agent and Sub Agent requests (with sub-types: Bash, Task, Plan, General)
- Request list auto-scrolls to the selected item (centered on mode switch, nearest on manual click)
- Right panel supports Request / Response tab switching
- Request Body expands `messages`, `system`, `tools` one level by default
- Response Body fully expanded by default
- Toggle between JSON view and plain text view
- One-click JSON content copy
- MainAgent requests support Body Diff JSON, showing a collapsible diff with the previous MainAgent request (only changed/added fields)
- Diff section supports JSON/Text view switching and one-click copy
- "Expand Diff" setting: when enabled, MainAgent requests auto-expand the diff section
- Body Diff JSON tooltip is dismissible; once closed, the preference is persisted server-side and never shown again
- Sensitive headers (`x-api-key`, `authorization`) are automatically masked in JSONL log files to prevent credential leakage
- Inline token usage stats per request (input/output tokens, cache creation/read, hit rate)
- Compatible with Claude Code Router (CCR) and other proxy setups — requests are matched by API path pattern as a fallback

### Chat Mode

Click the "Chat mode" button in the top right to parse Main Agent's full conversation history into a chat interface:

- User messages right-aligned (blue bubbles), Main Agent replies left-aligned (dark bubbles) with Markdown rendering
- `/compact` messages auto-detected and displayed collapsed, click to expand full summary
- Tool call results displayed inline within the corresponding Assistant message
- `thinking` blocks collapsed by default, rendered as Markdown, click to expand; supports one-click translation
- `tool_use` shown as compact tool call cards (Bash, Read, Edit, Write, Glob, Grep, Task each have dedicated displays)
- Task (SubAgent) tool results rendered as Markdown
- User selection messages (AskUserQuestion) shown in Q&A format
- System tags (`<system-reminder>`, `<project-reminder>`, etc.) auto-collapsed
- Skill loaded messages auto-detected and collapsed, showing skill name; click to expand full documentation with Markdown rendering
- Skills reminder auto-detected and collapsed
- System text auto-filtered, showing only real user input
- Multi-session segmented display (auto-segmented after `/compact`, `/clear`, etc.)
- Each message shows a timestamp accurate to the second, derived from API request timing
- Each message has a "View Request" link to jump back to raw mode at the corresponding API request
- Bidirectional mode sync: switching to chat mode scrolls to the conversation matching the selected request; switching back scrolls to the selected request
- Settings panel: toggle default collapse state for tool results and thinking blocks
- Global settings: toggle filtering of irrelevant requests (count_tokens, heartbeat) from the request list

### Translation

- Thinking blocks and assistant messages support one-click translation
- Powered by Claude Haiku API, supports both API key (`x-api-key`) and OAuth Bearer token authentication
- Translation results are cached; click again to toggle back to the original text
- Loading spinner animation shown during translation

### Token Stats

Hover panel in the header area:

- Token counts grouped by model (input/output)
- Cache creation/read counts and cache hit rate
- Cache rebuild statistics: grouped by reason (TTL, system/tools/model change, message truncation/modification, key change) with count and cache_creation tokens
- Tool usage statistics: call counts per tool, sorted by frequency
- Skill usage statistics: call counts per skill, sorted by frequency
- Concept help (?) icons: click to view built-in documentation for MainAgent, CacheRebuild, and each tool
- Main Agent cache expiration countdown

### Log Management

Via the CC-Viewer dropdown menu in the top left:

- Import local logs: browse historical log files, grouped by project, opens in new window
- Load local JSONL file: directly select and load a local `.jsonl` file (up to 500MB)
- Download current log: download the current monitoring JSONL log file
- Merge logs: combine multiple JSONL log files into a single session for unified analysis
- Export user prompts: extract and display all user inputs with three view modes — Original (raw content), Context (with system tags collapsible), and Text (plain text only); slash commands (`/model`, `/context`, etc.) shown as standalone entries; command-related tags auto-hidden from prompt content
- Export prompts to TXT: export user prompts (text only, excluding system tags) to a local `.txt` file

### Multi-language Support

CC-Viewer supports 18 languages, automatically switching based on system locale:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
