# systemPromptModel.md 变量

此文件仅记录 `systemPromptModel.md` 中必须在运行时解析的变量。每个叶变量解析为字符串、数字或空字符串 `""`；当无法获得值时，统一回退到空字符串。

## 工作区和用户环境

| Variable | Description | Example |
|---|---|---|
| `${environment.cwd}` | 当前主工作目录。 | `/Users/sky/claude-code` |
| `${environment.originalCwd}` | 进程/会话启动时的原始工作目录。 | `/Users/sky/claude-code` |
| `${environment.home}` | 用户主目录，用于解析 `~`。 | `/Users/sky` |
| `${environment.user}` | 当前系统用户名。 | `sky` |
| `${environment.workspaceRoots}` | 当前会话的工作区根目录；可能呈现为换行符分隔的字符串。 | `/Users/sky/claude-code` |
| `${environment.path}` | 当前进程 PATH。 | `/opt/homebrew/bin:/usr/bin:/bin` |
| `${environment.lang}` | 当前语言环境。 | `zh_CN.UTF-8` |

## 操作系统

| Variable | Description | Example |
|---|---|---|
| `${os.platform}` | Node.js 识别的平台。 | `darwin` |
| `${os.type}` | 操作系统类型。 | `Darwin` |
| `${os.arch}` | CPU 架构。 | `arm64` |
| `${os.shell}` | 当前 shell。 | `/bin/zsh` |
| `${os.version}` | 操作系统版本描述。 | `Darwin Kernel Version ...` |
| `${os.release}` | 操作系统发行版本。 | `24.5.0` |
| `${os.hostname}` | 当前主机名。 | `MacBook-Pro.local` |
| `${os.availableParallelism}` | 可用并行度。 | `10` |
| `${os.totalMemory}` | 系统总内存，以字节为单位。 | `34359738368` |
| `${os.freeMemory}` | 可用内存，以字节为单位。 | `8589934592` |
| `${os.uptime}` | 系统运行时间，以秒为单位。 | `123456` |

## Node.js 运行时

| Variable | Description | Example |
|---|---|---|
| `${runtime.nodeVersion}` | 当前 Node.js 版本。 | `v24.14.0` |
| `${runtime.execPath}` | 当前 Node.js 可执行文件的路径。 | `/opt/homebrew/bin/node` |
| `${runtime.pid}` | 当前进程 ID。 | `12345` |
| `${runtime.ppid}` | 父进程 ID。 | `1234` |

## 时间

| Variable | Description | Example |
|---|---|---|
| `${time.current}` | 当前本地时间字符串。 | `Thu Jul 09 2026 18:22:09 GMT+0800 (China Standard Time)` |
| `${time.iso}` | 当前 ISO 时间。 | `2026-07-09T10:22:09.000Z` |
| `${time.date}` | 当前本地日期。 | `2026-07-09` |
| `${time.timezone}` | 当前系统时区。 | `Asia/Shanghai` |

## 权限和沙箱

| Variable | Description | Example |
|---|---|---|
| `${permissions.mode}` | 当前工具权限模式。 | `default` |
| `${permissions.approvalsReviewer}` | 当前审批策略或审核者模式。 | `auto_review` |
| `${sandbox.mode}` | 文件系统沙箱模式。 | `workspace-write` |
| `${sandbox.networkAccess}` | 网络访问状态。 | `enabled` |
| `${sandbox.writableRoots}` | 沙箱允许写入的目录；可能呈现为换行符分隔的字符串。 | `/Users/sky/Documents/Playground` |

## 终端

| Variable | Description | Example |
|---|---|---|
| `${terminal.term}` | 当前 TERM。 | `xterm-256color` |
| `${terminal.colorTerm}` | 当前 COLORTERM。 | `truecolor` |
| `${terminal.columns}` | 当前终端列数。 | `120` |
| `${terminal.rows}` | 当前终端行数。 | `40` |

## 文件系统

| Variable | Description | Example |
|---|---|---|
| `${filesystem.tmpdir}` | 系统临时目录。 | `/var/folders/.../T` |
| `${filesystem.pathSeparator}` | 文件路径分隔符。 | `/` |
| `${filesystem.pathDelimiter}` | PATH 项分隔符。 | `:` |

## 模型

| Variable | Description | Example |
|---|---|---|
| `${model.name}` | 当前模型名称或 ID。 | `claude-opus-4-6` |
| `${model.knowledgeCutoff}` | 当前模型知识截止日期；此值无法从操作系统派生，必须通过外部配置或覆盖注入。 | `May 2025` |

## Git

| Variable | Description | Example |
|---|---|---|
| `${git.isRepository}` | 当前目录是否在 git 仓库内，以字符串形式表示。 | `true` |
| `${git.root}` | Git 仓库根目录。 | `/Users/sky/project` |
| `${git.branch}` | 当前 git 分支或短 HEAD 哈希。 | `main` |
| `${git.mainBranch}` | 默认主分支，通常用作 PR 或合并目标。 | `main` |
| `${git.userName}` | 当前 git `user.name`。 | `Sky` |
| `${git.status}` | `git status --short` 的输出。 | `M src/index.ts` |
| `${git.recentCommits}` | 最近提交的摘要。 | `abc1234 Fix prompt builder` |

## 记忆

记忆变量描述持久性文件的内存目录。当设置 `CC_MEMORY_DIR` / `CLAUDE_MEMORY_DIR` 覆盖时，`${memory.dir}` 从其解析；否则计算为 `<home>/.claude/projects/<slug>/memory/`，其中 `<slug>` 是主工作目录，每个非字母数字字符替换为 `-`。`${memory.index}` 保持该目录内 `MEMORY.md` 的内容（每个会话加载的索引），`${memory.enabled}` 报告内存是否可用。`# Memory` 和 `# Memory index` 部分仅在内存启用时组装。

| Variable | Description | Example |
|---|---|---|
| `${memory.dir}` | 已解析的内存目录。 | `/Users/sky/.claude/projects/-Users-sky-project/memory/` |
| `${memory.index}` | `MEMORY.md` 的内容，或不存在时为 `""`。 | `# Memory index\n- [Commit to main](commit-to-main.md) — hook` |
| `${memory.enabled}` | 内存是否可用，以字符串形式表示。 | `true` |

## 暂存区

暂存区是会话特定的，无法从操作系统派生；必须通过 `CC_SCRATCHPAD_DIR` / `CLAUDE_SCRATCHPAD_DIR` 覆盖注入。未设置时回退到 `""`，`# Scratchpad Directory` 部分从组装中省略。

| Variable | Description | Example |
|---|---|---|
| `${scratchpad.dir}` | 会话特定的临时目录。 | `/private/tmp/claude-501/<slug>/<session>/scratchpad` |
