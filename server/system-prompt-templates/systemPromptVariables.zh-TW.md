# systemPromptModel.md 變數

本檔案僅記錄 `systemPromptModel.md` 中必須在執行時解析的變數。每個葉變數解析為字串、數字或空字串 `""`；當無法取得值時，統一回退到空字串。

## 工作區和使用者環境

| Variable | Description | Example |
|---|---|---|
| `${environment.cwd}` | 目前主工作目錄。 | `/Users/sky/claude-code` |
| `${environment.originalCwd}` | 行程/工作階段啟動時的原始工作目錄。 | `/Users/sky/claude-code` |
| `${environment.home}` | 使用者主目錄，用於解析 `~`。 | `/Users/sky` |
| `${environment.user}` | 目前系統使用者名稱。 | `sky` |
| `${environment.workspaceRoots}` | 目前工作階段的工作區根目錄；可能呈現為換行符分隔的字串。 | `/Users/sky/claude-code` |
| `${environment.path}` | 目前行程 PATH。 | `/opt/homebrew/bin:/usr/bin:/bin` |
| `${environment.lang}` | 目前語言環境。 | `zh_CN.UTF-8` |

## 作業系統

| Variable | Description | Example |
|---|---|---|
| `${os.platform}` | Node.js 識別的平台。 | `darwin` |
| `${os.type}` | 作業系統類型。 | `Darwin` |
| `${os.arch}` | CPU 架構。 | `arm64` |
| `${os.shell}` | 目前 shell。 | `/bin/zsh` |
| `${os.version}` | 作業系統版本說明。 | `Darwin Kernel Version ...` |
| `${os.release}` | 作業系統發行版本。 | `24.5.0` |
| `${os.hostname}` | 目前主機名稱。 | `MacBook-Pro.local` |
| `${os.availableParallelism}` | 可用並行度。 | `10` |
| `${os.totalMemory}` | 系統總記憶體，以位元組為單位。 | `34359738368` |
| `${os.freeMemory}` | 可用記憶體，以位元組為單位。 | `8589934592` |
| `${os.uptime}` | 系統運行時間，以秒為單位。 | `123456` |

## Node.js 執行環境

| Variable | Description | Example |
|---|---|---|
| `${runtime.nodeVersion}` | 目前 Node.js 版本。 | `v24.14.0` |
| `${runtime.execPath}` | 目前 Node.js 可執行檔的路徑。 | `/opt/homebrew/bin/node` |
| `${runtime.pid}` | 目前行程 ID。 | `12345` |
| `${runtime.ppid}` | 父行程 ID。 | `1234` |

## 時間

| Variable | Description | Example |
|---|---|---|
| `${time.current}` | 目前本地時間字串。 | `Thu Jul 09 2026 18:22:09 GMT+0800 (China Standard Time)` |
| `${time.iso}` | 目前 ISO 時間。 | `2026-07-09T10:22:09.000Z` |
| `${time.date}` | 目前本地日期。 | `2026-07-09` |
| `${time.timezone}` | 目前系統時區。 | `Asia/Shanghai` |

## 權限和沙箱

| Variable | Description | Example |
|---|---|---|
| `${permissions.mode}` | 目前工具權限模式。 | `default` |
| `${permissions.approvalsReviewer}` | 目前核准政策或審核者模式。 | `auto_review` |
| `${sandbox.mode}` | 檔案系統沙箱模式。 | `workspace-write` |
| `${sandbox.networkAccess}` | 網路存取狀態。 | `enabled` |
| `${sandbox.writableRoots}` | 沙箱允許寫入的目錄；可能呈現為換行符分隔的字串。 | `/Users/sky/Documents/Playground` |

## 終端

| Variable | Description | Example |
|---|---|---|
| `${terminal.term}` | 目前 TERM。 | `xterm-256color` |
| `${terminal.colorTerm}` | 目前 COLORTERM。 | `truecolor` |
| `${terminal.columns}` | 目前終端欄數。 | `120` |
| `${terminal.rows}` | 目前終端列數。 | `40` |

## 檔案系統

| Variable | Description | Example |
|---|---|---|
| `${filesystem.tmpdir}` | 系統暫存目錄。 | `/var/folders/.../T` |
| `${filesystem.pathSeparator}` | 檔案路徑分隔符。 | `/` |
| `${filesystem.pathDelimiter}` | PATH 項目分隔符。 | `:` |

## 模型

| Variable | Description | Example |
|---|---|---|
| `${model.name}` | 目前模型名稱或 ID。 | `claude-opus-4-6` |
| `${model.knowledgeCutoff}` | 目前模型知識截止日期；此值無法從作業系統衍生，必須透過外部設定或覆寫注入。 | `May 2025` |

## Git

| Variable | Description | Example |
|---|---|---|
| `${git.isRepository}` | 目前目錄是否在 git 儲存庫內，以字串形式表示。 | `true` |
| `${git.root}` | Git 儲存庫根目錄。 | `/Users/sky/project` |
| `${git.branch}` | 目前 git 分支或短 HEAD 雜湊。 | `main` |
| `${git.mainBranch}` | 預設主分支，通常用作 PR 或合併目標。 | `main` |
| `${git.userName}` | 目前 git `user.name`。 | `Sky` |
| `${git.status}` | `git status --short` 的輸出。 | `M src/index.ts` |
| `${git.recentCommits}` | 最近提交的摘要。 | `abc1234 Fix prompt builder` |

## 記憶

記憶變數描述持久性檔案的記憶目錄。當設定 `CC_MEMORY_DIR` / `CLAUDE_MEMORY_DIR` 覆寫時，`${memory.dir}` 從其解析；否則計算為 `<home>/.claude/projects/<slug>/memory/`，其中 `<slug>` 是主工作目錄，每個非英數字元替換為 `-`。`${memory.index}` 保存該目錄內 `MEMORY.md` 的內容（每個工作階段載入的索引），`${memory.enabled}` 報告記憶是否可用。`# Memory` 和 `# Memory index` 部分僅在記憶啟用時組裝。

| Variable | Description | Example |
|---|---|---|
| `${memory.dir}` | 已解析的記憶目錄。 | `/Users/sky/.claude/projects/-Users-sky-project/memory/` |
| `${memory.index}` | `MEMORY.md` 的內容，或不存在時為 `""`。 | `# Memory index\n- [Commit to main](commit-to-main.md) — hook` |
| `${memory.enabled}` | 記憶是否可用，以字串形式表示。 | `true` |

## 暫存區

暫存區是工作階段特定的，無法從作業系統衍生；必須透過 `CC_SCRATCHPAD_DIR` / `CLAUDE_SCRATCHPAD_DIR` 覆寫注入。未設定時回退到 `""`，`# Scratchpad Directory` 部分從組裝中省略。

| Variable | Description | Example |
|---|---|---|
| `${scratchpad.dir}` | 工作階段特定的暫存目錄。 | `/private/tmp/claude-501/<slug>/<session>/scratchpad` |
