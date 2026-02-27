# CC-Viewer

A Claude Code request monitoring system that captures and visualizes all API requests and responses from Claude Code in real time (raw text, unredacted). Helps developers monitor their context for review and troubleshooting during Vibe Coding sessions.

English | [简体中文](./docs/README.zh.md) | [繁體中文](./docs/README.zh-TW.md) | [한국어](./docs/README.ko.md) | [日本語](./docs/README.ja.md) | [Deutsch](./docs/README.de.md) | [Español](./docs/README.es.md) | [Français](./docs/README.fr.md) | [Italiano](./docs/README.it.md) | [Dansk](./docs/README.da.md) | [Polski](./docs/README.pl.md) | [Русский](./docs/README.ru.md) | [العربية](./docs/README.ar.md) | [Norsk](./docs/README.no.md) | [Português (Brasil)](./docs/README.pt-BR.md) | [ไทย](./docs/README.th.md) | [Türkçe](./docs/README.tr.md) | [Українська](./docs/README.uk.md)

## Usage

### Installation

```bash
npm install -g cc-viewer
```

### Running and Auto-Configuration

```bash
ccv
```

This command automatically detects how Claude Code is installed locally (NPM or Native Install) and adapts accordingly.

- **NPM Install**: Automatically injects an interceptor script into Claude Code's `cli.js`.
- **Native Install**: Automatically detects the `claude` binary, configures a local transparent proxy, and sets up a Zsh Shell Hook to forward traffic automatically.

### Configuration Override

If you need to use a custom API endpoint (e.g., a corporate proxy), simply configure it in `~/.claude/settings.json` or set the `ANTHROPIC_BASE_URL` environment variable. `ccv` will automatically detect and correctly forward requests.

### Silent Mode

By default, `ccv` runs in silent mode when wrapping `claude`, keeping your terminal output clean and consistent with the native experience. All logs are captured in the background and can be viewed at `http://localhost:7008`.

Once configured, use the `claude` command as normal. Visit `http://localhost:7008` to access the monitoring interface.

### Troubleshooting

If you encounter issues starting cc-viewer, here is the ultimate troubleshooting approach:

Step 1: Open Claude Code in any directory.

Step 2: Give Claude Code the following instruction:
```
I have installed the cc-viewer npm package, but after running ccv it still doesn't work properly. Please check cc-viewer's cli.js and findcc.js, and adapt them to the local Claude Code deployment based on the specific environment. Keep the scope of changes as constrained as possible within findcc.js.
```
Letting Claude Code diagnose the issue itself is more effective than asking anyone or reading any documentation!

After the above instruction is completed, `findcc.js` will be updated. If your project frequently requires local deployment, or if forked code often needs to resolve installation issues, keeping this file lets you simply copy it next time. At this stage, many projects and companies using Claude Code are not deploying on Mac but rather on server-side hosted environments, so the author has separated `findcc.js` to make it easier to track cc-viewer source code updates going forward.

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
- Captures all API requests made by Claude Code in real time, ensuring raw content rather than truncated logs (this is important!!!)
- Automatically identifies and labels Main Agent and Sub Agent requests (subtypes: Bash, Task, Plan, General)
- MainAgent requests support Body Diff JSON, showing a collapsed diff of changes from the previous MainAgent request (only changed/added fields)
- Inline token usage stats per request (input/output tokens, cache creation/read, hit rate)
- Compatible with Claude Code Router (CCR) and other proxy scenarios — falls back to API path pattern matching

### Conversation Mode

Click the "Conversation Mode" button in the top-right corner to parse the Main Agent's full conversation history into a chat interface:
<img width="1500" height="730" alt="image" src="https://github.com/user-attachments/assets/c973f142-748b-403f-b2b7-31a5d81e33e6" />


- Agent Team display is not yet supported
- User messages are right-aligned (blue bubbles), Main Agent replies are left-aligned (dark bubbles)
- `thinking` blocks are collapsed by default, rendered in Markdown, and can be expanded to view the reasoning process; one-click translation is supported (feature is still unstable)
- User selection messages (AskUserQuestion) are displayed in a Q&A format
- Bidirectional mode sync: switching to Conversation Mode automatically navigates to the conversation corresponding to the selected request; switching back to Raw Mode automatically navigates to the selected request
- Settings panel: toggle the default collapsed state of tool results and thinking blocks


### Statistics Tool

The "Data Statistics" floating panel in the header area:
<img width="1500" height="729" alt="image" src="https://github.com/user-attachments/assets/b23f9a81-fc3d-4937-9700-e70d84e4e5ce" />

- Displays cache creation/read counts and cache hit rate
- Cache rebuild statistics: grouped by reason (TTL, system/tools/model changes, message truncation/modification, key changes) showing counts and cache_creation tokens
- Tool usage statistics: displays call frequency for each tool sorted by number of calls
- Skill usage statistics: displays call frequency for each skill sorted by number of calls
- Concept help (?) icon: click to view built-in documentation for MainAgent, CacheRebuild, and each tool

### Log Management

Via the CC-Viewer dropdown menu in the top-left corner:
<img width="1200" height="672" alt="image" src="https://github.com/user-attachments/assets/8cf24f5b-9450-4790-b781-0cd074cd3b39" />

- Import local logs: browse historical log files grouped by project, open in a new window
- Load local JSONL file: directly select a local `.jsonl` file to load and view (supports up to 500MB)
- Save current log as: download the current monitoring JSONL log file
- Merge logs: combine multiple JSONL log files into a single session for unified analysis
- View user Prompts: extract and display all user inputs, supporting three view modes — Raw mode (original content), Context mode (system tags collapsible), Text mode (plain text); slash commands (`/model`, `/context`, etc.) shown as standalone entries; command-related tags are auto-hidden from Prompt content
- Export Prompts to TXT: export user Prompts (plain text, excluding system tags) to a local `.txt` file

### Multi-language Support

CC-Viewer supports 18 languages, automatically switching based on system locale:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
