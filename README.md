<img width="1500" height="100" alt="未标题-2" src="https://github.com/user-attachments/assets/543ecd96-2e2c-43ce-a396-852239eb8932" />



# CC-Viewer

🌐 **Website & feature tour: [weiesky.github.io/cc-viewer](https://weiesky.github.io/cc-viewer/)** — available in 18 languages (e.g. [简体中文](https://weiesky.github.io/cc-viewer/?lang=zh), [日本語](https://weiesky.github.io/cc-viewer/?lang=ja)).

Based on Claude Code, a Vibe Coding tool that distills and accumulates real development experience:

<img width="860" alt="cc-viewer — deploy once, share with every device" src="https://raw.githubusercontent.com/weiesky/cc-viewer/main/docs/cc-viewer-share.svg" />

English | [简体中文](./docs/README.zh.md) | [繁體中文](./docs/README.zh-TW.md) | [한국어](./docs/README.ko.md) | [日本語](./docs/README.ja.md) | [Deutsch](./docs/README.de.md) | [Español](./docs/README.es.md) | [Français](./docs/README.fr.md) | [Italiano](./docs/README.it.md) | [Dansk](./docs/README.da.md) | [Polski](./docs/README.pl.md) | [Русский](./docs/README.ru.md) | [العربية](./docs/README.ar.md) | [Norsk](./docs/README.no.md) | [Português (Brasil)](./docs/README.pt-BR.md) | [ไทย](./docs/README.th.md) | [Türkçe](./docs/README.tr.md) | [Українська](./docs/README.uk.md)

## Usage

### Prerequisites

* Make sure nodejs 20.0.0+ is installed; [Download and install](https://nodejs.org)
* Make sure claude code is installed; [Installation guide](https://github.com/anthropics/claude-code)

### Install ccv

#### Install via npm

```bash
npm install -g cc-viewer --registry=https://registry.npmjs.org
```

#### Install via Homebrew (recommended for macOS / Linux)

```bash
brew tap weiesky/cc-viewer
brew install cc-viewer
brew upgrade cc-viewer   # use this to upgrade; do NOT use npm install -g to upgrade a brew-installed ccv
```

### How to start

ccv is a drop-in replacement for claude — all arguments are passed through to claude while the Web Viewer is launched alongside it.

```bash
ccv                    # == claude (interactive mode)
```

The command I use most often is:

```
ccv -c --d             # == claude --continue --dangerously-skip-permissions
                       # ccv passes through every Claude Code launch argument — feel free to combine them however you like
```

Once started in programming mode, the web page opens automatically.

cc-viewer also ships as a native desktop app: [download page](https://github.com/weiesky/cc-viewer/releases)

### Choose the Claude executable

On the local CCV page, open **Global Settings → Claude executable** to choose the
Claude Code installation used by CLI, `ccv run -- claude`, and the desktop app.
CCV suggests executables found in CodeFuse, `PATH`, npm, and common native-install
locations. You may also enter an absolute path (or a `~/...` path). The selection
is saved as `claudeExecutablePath` in `~/.claude/cc-viewer/preferences.json` and
takes effect on the next launch.

An explicit selection is authoritative: if it is later missing or not executable,
CCV stops with an error instead of silently launching another version. Clear the
field to restore automatic discovery. For headless setup, write the same absolute
path to `claudeExecutablePath` manually. Executable selection is a machine-local
admin setting and is not exposed to LAN clients. CCV disables Claude Code's
self-updater for processes it launches, so upgrades remain under the control of
the selected installation or its package manager.

### Upgrading to 1.7.0 (log format v2)

Since 1.7.0, logs are stored in a per-session directory format (wire-format v2) instead of single `.jsonl` files — roughly 90% smaller on disk. Existing v1 `.jsonl` files are never modified or deleted; the log dialog lists v2 sessions by default, and a small “View legacy (v1) logs” entry (shown while old files exist) opens a v1 view where they can be viewed, migrated, or deleted. On startup, cc-viewer offers one-click migration when legacy logs are found (strongly recommended when continuing an old conversation with `claude -c`, whose first half lives in the old files). You can also migrate from the terminal:

```bash
ccv convert <project>   # migrate one project
ccv convert --all       # migrate every project
ccv verify <v1-file>    # check a v1 file against its converted sessions
```

A session that fails golden verification is held in `sessions-quarantine/` for inspection instead of failing the whole migration — the other sessions still migrate.

### Logger mode

If you still prefer the native claude tool or the VS Code extension, use this mode.

In this mode, launching `claude` will automatically start a logging process that records request logs to per-session directories under \~/.claude/cc-viewer/*yourproject*/sessions/ (wire-format v2)

Enable logger mode:

```bash
ccv -logger
```

When the console cannot print a specific port, the default first port is 127.0.0.1:7008. If multiple instances exist, ports increment sequentially — 7009, 7010, and so on.

Uninstall logger mode:

```bash
ccv --uninstall
```

### Troubleshooting

If you run into start-up issues, here's the ultimate troubleshooting recipe:
Step 1: Open Claude Code in any directory;
Step 2: Give Claude Code the following instruction:

```
I have installed the cc-viewer npm package, but running ccv still doesn't work properly. Check cc-viewer's cli.js and findcc.js and adapt them to the local Claude Code deployment based on the specific environment. Keep the scope of changes confined to findcc.js as much as possible.
```

Letting Claude Code diagnose the problem on its own is more effective than asking anyone or reading any documentation!

Once the instruction is done, `findcc.js` will have been updated. If your project frequently needs local deployment, or your forked code often runs into installation issues, just keep this file — next time you can simply copy it over. At this stage many projects and companies use Claude Code on server-side hosted deployments rather than on Mac, so I split out `findcc.js` to make it easier to keep tracking upstream cc-viewer source updates.

Note: this app conflicts with claude-code-switch and claude-code-router — there is a proxy contention problem, so make sure you turn off claude-code-switch and claude-code-router when using it. cc-viewer provides built-in proxy hot-reload that can replace them. The hot-switch dialog also supports per-role sources — Main Agent, Sub-Agents and Teammates can each use a different proxy profile (default: follow the Main Agent); when the Main Agent uses the built-in Default with the official endpoint, role assignment stays hidden and dormant.

### Other helper commands

See:

```bash
ccv -h
```

### Silent Mode

By default, `ccv` runs in silent mode when wrapping `claude`, keeping your terminal output clean and consistent with the native experience. All logs are captured in the background and can be viewed at `http://localhost:7008`.

Once configured, just use the `claude` command as usual. Visit `http://localhost:7008` to open the monitoring UI.

## Features

### Programming mode

After launching with ccv you'll see:

<img height="765" width="1500" alt="image" src="https://github.com/user-attachments/assets/ab353a2b-f101-409d-a28c-6a4e41571ea2" />

You can view the code diff directly right after an edit:

<img height="728" width="1500" alt="image" src="https://github.com/user-attachments/assets/2a4acdaa-fc5f-4dc0-9e5f-f3273f0849b2" />

While you can open files and code by hand, that's not recommended — that's the old-school way!

### Code search

The activity bar includes a VS Code-style **Search across files** view (the magnifier icon, next to File Explorer and Git). Type a keyword or regular expression and get matches grouped by file with the matched text highlighted; click a result to jump straight to that line with the match selected. The usual toggles are there — **Match Case**, **Match Whole Word**, **Use Regular Expression**, and a "…" expander for **files to include / exclude** globs. Search is scoped to the current project and honors `.gitignore` (it uses [ripgrep](https://github.com/BurntSushi/ripgrep) when it's installed for speed, and falls back to a built-in scanner otherwise, so there's nothing extra to install).

You can also **replace across files**: expand the replace row (the chevron next to the search box), and each match shows an inline before/after preview. Replace a single match, all matches in one file, or everywhere (replace-all asks for confirmation first). Regex mode supports `$1`/`$&` capture-group substitution. Replacements write directly to disk — files with unsaved edits open in the viewer are skipped, and there's no built-in undo, so lean on version control to revert.

### Mobile programming

You can even scan a QR code and code from a mobile device:

<img height="1460" width="3018" alt="image" src="https://github.com/user-attachments/assets/8debf48e-daec-420c-b37a-609f8b81cd20" />

<img height="790" width="1700" alt="image" src="https://github.com/user-attachments/assets/da3e519f-ff66-4cd2-81d1-f4e131215f6c" />

Everything you imagined about mobile coding — plus a plugin mechanism: if you need to customize for your own coding habits, stay tuned for plugin hook updates.

### Password protection

By default, remote (LAN) access requires the `?token=` query that ccv prints at startup. As an alternative that's friendlier to share, scan, or bookmark, you can turn on **password login**:

* Start with `ccv --usePassword` to enable it immediately. A bare flag auto-generates a 6-character password (uppercase letters + digits) and prints it to the console; `ccv --usePassword=<your-password>` sets a specific one. The password is shown in uppercase but matched case-insensitively at login, so it's easy to type on a phone.
* The machine that opens ccv on `127.0.0.1` is the **admin**: it never needs a password and is the only one allowed to view or change it. Open the QR-code popover — directly below the QR you can enable protection, edit/copy the password, or turn it back off.
* Remote devices opening the LAN URL (without a token) are shown a minimal password page; entering the correct password sets an `HttpOnly` cookie and the page refreshes into the app. The existing `?token=` URL keeps working in parallel.
* An **empty password means no protection at all** — it is allowed, but the admin UI shows a clear security warning.
* **Global default + per-project override:** by default one password covers every project. From the QR popover the admin can switch between **This project** and **Global** — set a project-specific password that overrides the global default for that project only, or remove the override to inherit the global setting again. (A disabled project override means "no protection for this project", which is different from removing it.)
* The on/off state and password(s) are persisted alongside your other settings in cc-viewer's `preferences.json` — a global `auth` key plus an optional `authByProject` map (the password is base64-obfuscated, not stored as raw plaintext; file mode `0600`). The login cookie is tied to the per-launch token, so restarting ccv requires remote devices to log in again.

### Model-specific system prompts

The **Edit System Prompt** modal (hamburger menu → Edit System Prompt) is tabbed:

* The **Default** tab keeps the classic behavior: it writes `CC_SYSTEM.md` (override) or `CC_APPEND_SYSTEM.md` (append) into the current workspace, injected as `--system-prompt-file` / `--append-system-prompt-file` on the next ccv launch.
* **Model tabs**: click **+ Add model**, type a name such as `opus` or `Gemini3`, and pick a scope — **Global** (`~/.claude/cc-viewer/system_prompt/`, applies to every workspace) or **Workspace** (`<project>/system_prompt/`). The name field offers type-ahead suggestions from your locally configured models (hot-reload proxy profiles and `settings.json`); names already added in the chosen scope are hidden, and arbitrary free-form names remain allowed. Each tab has its own Append/Override switch and Markdown preview.
* Entries are stored as uppercase files: `OPUS_SYSTEM.md` (override) or `OPUS_APPEND_SYSTEM.md` (append). Matching is fuzzy — a case-insensitive substring of the model ID resolved from the ACTIVE configuration (an active third-party proxy profile's model mapping > the launch environment's `ANTHROPIC_MODEL`/`CLAUDE_MODEL` > the `model` configured in `settings.json`; with no configuration signal, no entry is injected), so `opus` matches `claude-opus-4-8[1m]` regardless of version. Switching the proxy profile mid-session re-matches only after the claude session is restarted, and a `--model` flag passed through extra args is not consulted (known limitations). A workspace match beats a global one; within a scope the longest name wins; a matched entry fully replaces the Default files for that launch.
* Saving a tab empty deletes the entry. Model switches made mid-session apply at the next relaunch. Set `CCV_DISABLE_AUTO_SYSTEM_PROMPT=1` to disable all automatic injection. You may commit `<project>/system_prompt/` to share prompts with your team, or add it to `.gitignore` to keep them private.

### Logger mode (view the complete Claude Code session)

<img width="860" alt="cc-viewer — wire-level capture and packet decomposition" src="https://raw.githubusercontent.com/weiesky/cc-viewer/main/docs/cc-viewer-proxy.svg" />

* Captures every API request from Claude Code in real time, guaranteeing the raw payload rather than a censored log (this matters a lot!!!)
* Automatically identifies and labels Main Agent and Sub Agent requests (subtypes: Plan, Search, Bash)
* MainAgent requests support Body Diff JSON, showing only the diff against the previous MainAgent request (only changed/added fields) in a collapsed view
* Each request inlines Token usage stats (input/output tokens, cache creation/read, hit rate)
* Compatible with Claude Code Router (CCR) and other proxy scenarios — falls back to matching requests by API path pattern

## Star History

[![Star History Chart](https://api.star-history.com/chart?repos=weiesky/cc-viewer&type=date&legend=top-left&sealed_token=j2X2_c0TE1YPvV14JRmosH_FQhqDbWyTVlXO7A-LrTISexkOoasVDprqJ6Pp0fsRHbAZlwMNMHkoqEk1uD_3vTYaT9lJW3bFbO17293VsptQjoDRtsdjCQ)](https://www.star-history.com/?repos=weiesky%2Fcc-viewer&type=date&legend=top-left)

## License

MIT
