# CC-Viewer

Claude Code request monitoring system that captures and visualizes all API requests and responses from Claude Code in real time (raw text, untruncated). Helps developers monitor their Context for reviewing and troubleshooting during Vibe Coding.

English | [简体中文](./docs/README.zh.md) | [繁體中文](./docs/README.zh-TW.md) | [한국어](./docs/README.ko.md) | [日本語](./docs/README.ja.md) | [Deutsch](./docs/README.de.md) | [Español](./docs/README.es.md) | [Français](./docs/README.fr.md) | [Italiano](./docs/README.it.md) | [Dansk](./docs/README.da.md) | [Polski](./docs/README.pl.md) | [Русский](./docs/README.ru.md) | [العربية](./docs/README.ar.md) | [Norsk](./docs/README.no.md) | [Português (Brasil)](./docs/README.pt-BR.md) | [ไทย](./docs/README.th.md) | [Türkçe](./docs/README.tr.md) | [Українська](./docs/README.uk.md)

## Usage

### Installation

```bash
npm install -g cc-viewer
```

### Run & Auto-Configuration

```bash
ccv
```

This command automatically detects your local Claude Code installation method (NPM or Native Install) and adapts accordingly.

- **NPM Install**: Automatically injects an interceptor script into Claude Code's `cli.js`.
- **Native Install**: Automatically detects the `claude` binary, configures a local transparent proxy, and sets up a Zsh Shell Hook to automatically forward traffic.

### Configuration Override

If you need to use a custom API endpoint (e.g., corporate proxy), simply configure it in `~/.claude/settings.json` or set the `ANTHROPIC_BASE_URL` environment variable. `ccv` will automatically detect it and forward requests correctly.

### Silent Mode

By default, `ccv` runs in silent mode when wrapping `claude`, ensuring your terminal output stays clean and consistent with the native experience. All logs are captured in the background and can be viewed at `http://localhost:7008`.

Once configured, just use the `claude` command as usual. Visit `http://localhost:7008` to view the monitoring interface.

### Troubleshooting

- **Mixed Output**: If you see `[CC-Viewer]` debug logs mixed with Claude's output, please update to the latest version (`npm install -g cc-viewer`).
- **Connection Refused**: Make sure the `ccv` background process is running. Running `ccv` or `claude` (after hook installation) should start it automatically.
- **Empty Body**: If you see "No Body" in the Viewer, it may be due to non-standard SSE formats. The Viewer now supports capturing raw content as a fallback.

### Uninstall

```bash
ccv --uninstall
```

### Check Version

```bash
ccv --version
```

## Features

### Request Monitoring (Raw Mode)
<img width="1500" height="720" alt="image" src="https://github.com/user-attachments/assets/519dd496-68bd-4e76-84d7-2a3d14ae3f61" />
- Real-time capture of all API requests from Claude Code, ensuring raw text rather than truncated logs (this is important!!!)
- Automatically identifies and labels Main Agent and Sub Agent requests (sub-types: Bash, Task, Plan, General)
- MainAgent requests support Body Diff JSON, showing a collapsible diff with the previous MainAgent request (only changed/added fields)
- Inline token usage stats per request (input/output tokens, cache creation/read, hit rate)
- Compatible with Claude Code Router (CCR) and other proxy setups — requests are matched by API path pattern as a fallback

### Chat Mode

Click the "Chat Mode" button in the top right to parse Main Agent's full conversation history into a chat interface:
<img width="1500" height="730" alt="image" src="https://github.com/user-attachments/assets/c973f142-748b-403f-b2b7-31a5d81e33e6" />


- Agent Team display is not yet supported
- User messages are right-aligned (blue bubbles), Main Agent replies are left-aligned (dark bubbles)
- `thinking` blocks are collapsed by default, rendered in Markdown, click to expand and view the thinking process; one-click translation supported (feature is still unstable)
- User selection messages (AskUserQuestion) are displayed in Q&A format
- Bidirectional mode sync: switching to Chat Mode auto-scrolls to the conversation corresponding to the selected request; switching back to Raw Mode auto-scrolls to the selected request
- Settings panel: toggle default collapse state for tool results and thinking blocks


### Statistics Tool

"Data Statistics" hover panel in the header area:
<img width="1500" height="729" alt="image" src="https://github.com/user-attachments/assets/b23f9a81-fc3d-4937-9700-e70d84e4e5ce" />

- Displays cache creation/read counts and cache hit rate
- Cache rebuild statistics: grouped by reason (TTL, system/tools/model change, message truncation/modification, key change) showing count and cache_creation tokens
- Tool usage statistics: tools displayed by call frequency, sorted by count
- Skill usage statistics: skills displayed by call frequency, sorted by count
- Concept help (?) icons: click to view built-in documentation for MainAgent, CacheRebuild, and each tool

### Log Management

Via the CC-Viewer dropdown menu in the top left:
<img width="1200" height="672" alt="image" src="https://github.com/user-attachments/assets/8cf24f5b-9450-4790-b781-0cd074cd3b39" />

- Import local logs: browse historical log files, grouped by project, opens in a new window
- Load local JSONL file: directly select and load a local `.jsonl` file (supports up to 500MB)
- Save current log as: download the current monitoring JSONL log file
- Merge logs: combine multiple JSONL log files into a single session for unified analysis
- View user Prompts: extract and display all user inputs, supporting three view modes — Raw mode (original content), Context mode (system tags collapsible), Text mode (plain text); slash commands (`/model`, `/context`, etc.) shown as standalone entries; command-related tags are auto-hidden from Prompt content
- Export Prompts to TXT: export user Prompts (plain text, excluding system tags) to a local `.txt` file

### Multi-language Support

CC-Viewer supports 18 languages, automatically switching based on system locale:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
