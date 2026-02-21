# CC-Viewer

A request monitoring system for Claude Code that captures and visualizes all API requests and responses in real time. Helps developers monitor their Context for reviewing and debugging during Vibe Coding.

[简体中文](./docs/README.zh.md) | [繁體中文](./docs/README.zh-TW.md) | [한국어](./docs/README.ko.md) | [日本語](./docs/README.ja.md) | [Deutsch](./docs/README.de.md) | [Español](./docs/README.es.md) | [Français](./docs/README.fr.md) | [Italiano](./docs/README.it.md) | [Dansk](./docs/README.da.md) | [Polski](./docs/README.pl.md) | [Русский](./docs/README.ru.md) | [العربية](./docs/README.ar.md) | [Norsk](./docs/README.no.md) | [Português (Brasil)](./docs/README.pt-BR.md) | [ไทย](./docs/README.th.md) | [Türkçe](./docs/README.tr.md) | [Українська](./docs/README.uk.md)

## Usage

```bash
npm install -g cc-viewer
```

After installation, run:

```bash
ccv
```

Then use Claude Code as usual and open `http://localhost:7008` in your browser to view the monitoring interface.

After Claude Code updates, no manual action is needed — the next time you run `claude`, it will automatically detect and reconfigure.

### Uninstall

```bash
ccv --uninstall
```

## Features

### Request Monitoring (Raw Mode)

- Real-time capture of all API requests from Claude Code, including streaming responses
- Left panel shows request method, URL, duration, and status code
- Automatically identifies and labels Main Agent and Sub Agent requests (with sub-types: Bash, Task, Plan, General)
- Right panel supports Request / Response tab switching
- Request Body expands `messages`, `system`, `tools` one level by default
- Response Body fully expanded by default
- Toggle between JSON view and plain text view
- One-click JSON content copy
- MainAgent requests support Body Diff JSON, showing a collapsible diff with the previous MainAgent request (only changed/added fields)
- Body Diff JSON tooltip is dismissible; once closed, the preference is persisted server-side and never shown again

### Chat Mode

Click the "Chat mode" button in the top right to parse Main Agent's full conversation history into a chat interface:

- User messages right-aligned (blue bubbles), Main Agent replies left-aligned (dark bubbles) with Markdown rendering
- `/compact` messages auto-detected and displayed collapsed, click to expand full summary
- Tool call results displayed inline within the corresponding Assistant message
- `thinking` blocks collapsed by default, click to expand
- `tool_use` shown as compact tool call cards (Bash, Read, Edit, Write, Glob, Grep, Task each have dedicated displays)
- User selection messages (AskUserQuestion) shown in Q&A format
- System tags (`<system-reminder>`, `<project-reminder>`, etc.) auto-collapsed
- System text auto-filtered, showing only real user input
- Multi-session segmented display (auto-segmented after `/compact`, `/clear`, etc.)
- Each message shows a timestamp accurate to the second

### Token Stats

Hover panel in the header area:

- Token counts grouped by model (input/output)
- Cache creation/read counts and cache hit rate
- Main Agent cache expiration countdown

### Log Management

Via the CC-Viewer dropdown menu in the top left:

- Import local logs: browse historical log files, grouped by project, opens in new window
- Load local JSONL file: directly select and load a local `.jsonl` file (up to 200MB)
- Download current log: download the current monitoring JSONL log file
- Export user prompts: extract and display all user inputs, with XML tags (system-reminder, etc.) collapsible; slash commands (`/model`, `/context`, etc.) shown as standalone entries; command-related tags auto-hidden from prompt content
- Export prompts to TXT: export user prompts (text only, excluding system tags) to a local `.txt` file

### Multi-language Support

CC-Viewer supports 18 languages, automatically switching based on system locale:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
