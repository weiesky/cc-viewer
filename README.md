<img width="148" height="149" alt="image" src="https://github.com/user-attachments/assets/c5d00eb9-7675-4d99-90d5-5fcc838fe8d2" />


# CC-Viewer

A Vibe Coding toolkit distilled from 15+ years of internet-industry R&D experience, built on top of Claude Code:

1. Run /ultraPlan and /ultraReview locally, so your code never has to be fully exposed to Claude's cloud;
2. Enables mobile programming over your local network (user-extensible);
3. Full Claude Code payload interception and analysis — great for logging, debugging, learning, and reverse-engineering;
4. Ships with accumulated study notes and hands-on experience (look for the "?" icons throughout the app), so we can explore and grow together;
5. Web UI adapts to every size mode — drop it into browser extensions, OS split views, and any embedding scenario; a native installer is also available.

English | [简体中文](./docs/README.zh.md) | [繁體中文](./docs/README.zh-TW.md) | [한국어](./docs/README.ko.md) | [日本語](./docs/README.ja.md) | [Deutsch](./docs/README.de.md) | [Español](./docs/README.es.md) | [Français](./docs/README.fr.md) | [Italiano](./docs/README.it.md) | [Dansk](./docs/README.da.md) | [Polski](./docs/README.pl.md) | [Русский](./docs/README.ru.md) | [العربية](./docs/README.ar.md) | [Norsk](./docs/README.no.md) | [Português (Brasil)](./docs/README.pt-BR.md) | [ไทย](./docs/README.th.md) | [Türkçe](./docs/README.tr.md) | [Українська](./docs/README.uk.md)

## Usage

### Installation

```bash
npm install -g cc-viewer --registry=https://registry.npmjs.org
```

### Programming Mode

ccv is a drop-in replacement for claude — all arguments are passed through to claude while launching the Web Viewer.

```bash
ccv                    # == claude (interactive mode)
ccv -c                 # == claude --continue (continue last conversation)
ccv -r                 # == claude --resume (resume a conversation)
ccv -p "hello"         # == claude --print "hello" (print mode)
ccv --d                # == claude --dangerously-skip-permissions (shortcut)
ccv --model opus       # == claude --model opus
```

The author's most-used command is:
```
ccv -c --d             # == claude --continue --dangerously-skip-permissions
```

After launching in programming mode, a web page will open automatically.

CC-Viewer also ships as a native desktop app — grab the build for your platform from GitHub.
[Download page](https://github.com/weiesky/cc-viewer/releases)


### Logger Mode

If you still prefer the native claude tool or the VS Code extension, use this mode.

In this mode, launching `claude` will automatically start a logging process that records request logs to ~/.claude/cc-viewer/*yourproject*/date.jsonl

Enable logger mode:
```bash
ccv -logger
```

When the console cannot print the specific port, the default first port is 127.0.0.1:7008. Multiple instances use sequential ports like 7009, 7010.

Uninstall logger mode:
```bash
ccv --uninstall
```

### Troubleshooting

If you encounter issues starting cc-viewer, here is the ultimate troubleshooting approach:

Step 1: Open Claude Code in any directory.

Step 2: Give Claude Code the following instruction:

```
I have installed the cc-viewer npm package, but after running ccv it still doesn't work properly. Please check cc-viewer's cli.js and findcc.js, and adapt them to the local Claude Code deployment based on the specific environment. Keep the scope of changes as constrained as possible within findcc.js.
```

Letting Claude Code diagnose the issue itself is more effective than asking anyone or reading any documentation!

After the above instruction is completed, `findcc.js` will be updated. If your project frequently requires local deployment, or if forked code often needs to resolve installation issues, keeping this file lets you simply copy it next time. At this stage, many projects and companies using Claude Code are not deploying on Mac but rather on server-side hosted environments, so the author has separated `findcc.js` to make it easier to track cc-viewer source code updates going forward.


### Other Commands

See:

```bash
ccv -h
```

### Silent Mode

By default, `ccv` runs in silent mode when wrapping `claude`, keeping your terminal output clean and consistent with the native experience. All logs are captured in the background and can be viewed at `http://localhost:7008`.

Once configured, use the `claude` command as normal. Visit `http://localhost:7008` to access the monitoring interface.


## Features


### Programming Mode

After launching with ccv, you can see:

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/ab353a2b-f101-409d-a28c-6a4e41571ea2" />


You can view code diffs directly after editing:

<img width="1500" height="728" alt="image" src="https://github.com/user-attachments/assets/2a4acdaa-fc5f-4dc0-9e5f-f3273f0849b2" />

While you can open files and code manually, manual coding is not recommended — that's old-school coding!

### Mobile Programming

You can even scan a QR code to code from your mobile device:

<img width="3018" height="1460" alt="image" src="https://github.com/user-attachments/assets/8debf48e-daec-420c-b37a-609f8b81cd20" />
<img width="1700" height="790" alt="image" src="https://github.com/user-attachments/assets/da3e519f-ff66-4cd2-81d1-f4e131215f6c" />

Fulfill your imagination of mobile programming. There's also a plugin mechanism — if you need to customize for your coding habits, stay tuned for plugin hooks updates.


### Logger Mode (View Complete Claude Code Sessions)

<img width="1500" height="768" alt="image" src="https://github.com/user-attachments/assets/a8a9f3f7-d876-4f6b-a64d-f323a05c4d21" />


- Captures all API requests from Claude Code in real time, ensuring raw text — not redacted logs (this is important!!!)
- Automatically identifies and labels Main Agent and Sub Agent requests (subtypes: Plan, Search, Bash)
- MainAgent requests support Body Diff JSON, showing collapsed differences from the previous MainAgent request (only changed/new fields)
- Each request displays inline Token usage statistics (input/output tokens, cache creation/read, hit rate)
- Compatible with Claude Code Router (CCR) and other proxy scenarios — falls back to API path pattern matching

### Conversation Mode

Click the "Conversation Mode" button in the top-right corner to parse the Main Agent's complete conversation history into a chat interface:

<img width="1500" height="764" alt="image" src="https://github.com/user-attachments/assets/725b57c8-6128-4225-b157-7dba2738b1c6" />

- Agent Team display is not yet supported
- User messages are right-aligned (blue bubbles), Main Agent replies are left-aligned (dark bubbles)
- `thinking` blocks are collapsed by default, rendered as Markdown — click to expand and view the thinking process; one-click translation is supported (feature is still unstable)
- User selection messages (AskUserQuestion) are displayed in Q&A format
- Bidirectional mode sync: switching to conversation mode auto-scrolls to the conversation corresponding to the selected request; switching back to raw mode auto-scrolls to the selected request
- Settings panel: toggle default collapse state for tool results and thinking blocks
- Mobile conversation browsing: in mobile CLI mode, tap the "Conversation Browse" button in the top bar to slide out a read-only conversation view for browsing the complete conversation history on mobile

### Log Management

Via the CC-Viewer dropdown menu in the top-left corner:

<img width="1500" height="760" alt="image" src="https://github.com/user-attachments/assets/33295e2b-f2e0-4968-a6f1-6f3d1404454e" />

**Log Compression**
Regarding logs, the author wants to clarify that the official Anthropic definitions have not been modified, ensuring log integrity. However, since individual log entries from the 1M Opus model can become extremely large in later stages, thanks to certain log optimizations for MainAgent, at least 66% size reduction is achieved without gzip. The parsing method for these compressed logs can be extracted from the current repository.

### More Useful Features

<img width="1500" height="767" alt="image" src="https://github.com/user-attachments/assets/add558c5-9c4d-468a-ac6f-d8d64759fdbd" />

You can quickly locate your prompts using the sidebar tools.

--- 

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/82b8eb67-82f5-41b1-89d6-341c95a047ed" />

The interesting KV-Cache-Text feature lets you see exactly what Claude sees.

---

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/54cdfa4e-677c-4aed-a5bb-5fd946600c46" />

You can upload images and describe your needs — Claude's image understanding is incredibly powerful. And as you know, you can paste images directly with Ctrl+V, and your complete content will be displayed in the conversation.

---

<img width="600" height="370" alt="image" src="https://github.com/user-attachments/assets/87d332ea-3e34-4957-b442-f9d070211fbf" />

You can customize plugins, manage all CC-Viewer processes, and CC-Viewer supports hot-switching to third-party APIs (yes, you can use GLM, Kimi, MiniMax, Qwen, DeepSeek — although the author considers them all quite weak at this point).

---

<img width="1500" height="746" alt="image" src="https://github.com/user-attachments/assets/b1f60c7c-1438-4ecc-8c64-193d21ee3445" />

More features waiting to be discovered... For example: the system supports Agent Team, and has a built-in Code Reviewer. Codex Code Reviewer integration is coming soon (the author highly recommends using Codex to review Claude Code's code).

## License

MIT
