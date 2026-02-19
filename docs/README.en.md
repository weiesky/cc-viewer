# CC-Viewer

A request monitoring system for Claude Code that captures and visualizes all API requests and responses in real time. Helps developers monitor their Context for reviewing and debugging during Vibe Coding.

[简体中文](../README.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Usage

```bash
npm install -g cc-viewer
```

After installation, run:

```bash
ccv
```

This command automatically configures your locally installed Claude Code for monitoring and adds an auto-repair hook to your shell config (`~/.zshrc` or `~/.bashrc`). Then use Claude Code as usual and open `http://localhost:7008` in your browser to view the monitoring interface.

After Claude Code updates, no manual action is needed — the next time you run `claude`, it will automatically detect and reconfigure.

### Uninstall

```bash
ccv --uninstall
```

## Features

### Request Monitoring (Raw Mode)

- Real-time capture of all API requests from Claude Code, including streaming responses
- Left panel shows request method, URL, duration, and status code
- Automatically identifies and labels Main Agent and Sub Agent requests
- Right panel supports Request / Response tab switching
- Request Body expands `messages`, `system`, `tools` one level by default
- Response Body fully expanded by default
- Toggle between JSON view and plain text view
- One-click JSON content copy
- MainAgent requests support Body Diff JSON, showing a collapsible diff with the previous MainAgent request (only changed/added fields)

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
- Export user prompts: extract and display all user inputs, with system-reminder collapsible view
- Export prompts to TXT: export user prompts to a local `.txt` file

### Multi-language Support

CC-Viewer supports 18 languages, automatically switching based on system locale:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
