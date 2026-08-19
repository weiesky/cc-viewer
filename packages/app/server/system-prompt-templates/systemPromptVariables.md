# systemPromptModel.md variables

This file documents only the variables in `systemPromptModel.md` that must be resolved at runtime. Every leaf variable resolves to a string, a number, or an empty string `""`; when a value cannot be obtained it falls back uniformly to an empty string.

## Workspace and user environment

| Variable | Description | Example |
|---|---|---|
| `${environment.cwd}` | Current primary working directory. | `/Users/sky/claude-code` |
| `${environment.originalCwd}` | Original working directory when the process/session started. | `/Users/sky/claude-code` |
| `${environment.home}` | User home directory, used to resolve `~`. | `/Users/sky` |
| `${environment.user}` | Current system username. | `sky` |
| `${environment.workspaceRoots}` | Workspace roots for the current session; may render as a newline-separated string. | `/Users/sky/claude-code` |
| `${environment.path}` | Current process PATH. | `/opt/homebrew/bin:/usr/bin:/bin` |
| `${environment.lang}` | Current locale or language environment. | `zh_CN.UTF-8` |

## Operating system

| Variable | Description | Example |
|---|---|---|
| `${os.platform}` | Platform as identified by Node.js. | `darwin` |
| `${os.type}` | Operating system type. | `Darwin` |
| `${os.arch}` | CPU architecture. | `arm64` |
| `${os.shell}` | Current shell. | `/bin/zsh` |
| `${os.version}` | Operating system version description. | `Darwin Kernel Version ...` |
| `${os.release}` | Operating system release. | `24.5.0` |
| `${os.hostname}` | Current hostname. | `MacBook-Pro.local` |
| `${os.availableParallelism}` | Available parallelism. | `10` |
| `${os.totalMemory}` | Total system memory, in bytes. | `34359738368` |
| `${os.freeMemory}` | Free memory, in bytes. | `8589934592` |
| `${os.uptime}` | System uptime, in seconds. | `123456` |

## Node.js runtime

| Variable | Description | Example |
|---|---|---|
| `${runtime.nodeVersion}` | Current Node.js version. | `v24.14.0` |
| `${runtime.execPath}` | Path to the current Node.js executable. | `/opt/homebrew/bin/node` |
| `${runtime.pid}` | Current process ID. | `12345` |
| `${runtime.ppid}` | Parent process ID. | `1234` |

## Time

| Variable | Description | Example |
|---|---|---|
| `${time.current}` | Current local time string. | `Thu Jul 09 2026 18:22:09 GMT+0800 (China Standard Time)` |
| `${time.iso}` | Current ISO time. | `2026-07-09T10:22:09.000Z` |
| `${time.date}` | Current local date. | `2026-07-09` |
| `${time.timezone}` | Current system timezone. | `Asia/Shanghai` |

## Permissions and sandbox

| Variable | Description | Example |
|---|---|---|
| `${permissions.mode}` | Current tool permission mode. | `default` |
| `${permissions.approvalsReviewer}` | Current approval policy or reviewer mode. | `auto_review` |
| `${sandbox.mode}` | Filesystem sandbox mode. | `workspace-write` |
| `${sandbox.networkAccess}` | Network access status. | `enabled` |
| `${sandbox.writableRoots}` | Directories the sandbox allows writing to; may render as a newline-separated string. | `/Users/sky/Documents/Playground` |

## Terminal

| Variable | Description | Example |
|---|---|---|
| `${terminal.term}` | Current TERM. | `xterm-256color` |
| `${terminal.colorTerm}` | Current COLORTERM. | `truecolor` |
| `${terminal.columns}` | Current terminal column count. | `120` |
| `${terminal.rows}` | Current terminal row count. | `40` |

## Filesystem

| Variable | Description | Example |
|---|---|---|
| `${filesystem.tmpdir}` | System temporary directory. | `/var/folders/.../T` |
| `${filesystem.pathSeparator}` | File path separator. | `/` |
| `${filesystem.pathDelimiter}` | PATH entry delimiter. | `:` |

## Model

| Variable | Description | Example |
|---|---|---|
| `${model.name}` | Current model name or ID. | `claude-opus-4-6` |
| `${model.knowledgeCutoff}` | Current model knowledge cutoff; this value cannot be derived from the operating system and must be injected via external configuration or an override. | `May 2025` |

## Git

| Variable | Description | Example |
|---|---|---|
| `${git.isRepository}` | Whether the current directory is inside a git repository, as a string. | `true` |
| `${git.root}` | Git repository root directory. | `/Users/sky/project` |
| `${git.branch}` | Current git branch or short HEAD hash. | `main` |
| `${git.mainBranch}` | Default main branch, typically used as the PR or merge target. | `main` |
| `${git.userName}` | Current git `user.name`. | `Sky` |
| `${git.status}` | Output of `git status --short`. | `M src/index.ts` |
| `${git.recentCommits}` | Summary of recent commits. | `abc1234 Fix prompt builder` |

## Memory

The memory variables describe the persistent file-based memory directory. `${memory.dir}` is resolved from the `CC_MEMORY_DIR` / `CLAUDE_MEMORY_DIR` override when set; otherwise it is computed as `<home>/.claude/projects/<slug>/memory/`, where `<slug>` is the primary working directory with every non-alphanumeric character replaced by `-`. `${memory.index}` holds the contents of `MEMORY.md` inside that directory (the index loaded each session), and `${memory.enabled}` reports whether memory is available. The `# Memory` and `# Memory index` sections are only assembled when memory is enabled.

| Variable | Description | Example |
|---|---|---|
| `${memory.dir}` | Resolved memory directory. | `/Users/sky/.claude/projects/-Users-sky-project/memory/` |
| `${memory.index}` | Contents of `MEMORY.md`, or `""` when absent. | `# Memory index\n- [Commit to main](commit-to-main.md) — hook` |
| `${memory.enabled}` | Whether memory is available, as a string. | `true` |

## Scratchpad

The scratchpad directory is session-specific and cannot be derived from the operating system; it must be injected via the `CC_SCRATCHPAD_DIR` / `CLAUDE_SCRATCHPAD_DIR` override. When unset it falls back to `""`, and the `# Scratchpad Directory` section is omitted from assembly.

| Variable | Description | Example |
|---|---|---|
| `${scratchpad.dir}` | Session-specific temporary directory. | `/private/tmp/claude-501/<slug>/<session>/scratchpad` |
