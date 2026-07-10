# systemPromptModel.md 変数

このファイルは、`systemPromptModel.md`内で実行時に解決する必要がある変数のみを文書化しています。すべてのリーフ変数は文字列、数値、または空の文字列 `""` に解決されます。値を取得できない場合、統一的に空の文字列にフォールバックします。

## ワークスペースとユーザー環境

| Variable | Description | Example |
|---|---|---|
| `${environment.cwd}` | 現在のプライマリ作業ディレクトリです。 | `/Users/sky/claude-code` |
| `${environment.originalCwd}` | プロセス/セッション開始時の元の作業ディレクトリです。 | `/Users/sky/claude-code` |
| `${environment.home}` | ユーザーホームディレクトリで、`~` を解決するために使用されます。 | `/Users/sky` |
| `${environment.user}` | 現在のシステムユーザー名です。 | `sky` |
| `${environment.workspaceRoots}` | 現在のセッションのワークスペースルート。改行区切りの文字列として表示される場合があります。 | `/Users/sky/claude-code` |
| `${environment.path}` | 現在のプロセスPATHです。 | `/opt/homebrew/bin:/usr/bin:/bin` |
| `${environment.lang}` | 現在のロケールまたは言語環境です。 | `zh_CN.UTF-8` |

## オペレーティングシステム

| Variable | Description | Example |
|---|---|---|
| `${os.platform}` | Node.js により識別されたプラットフォームです。 | `darwin` |
| `${os.type}` | オペレーティングシステムのタイプです。 | `Darwin` |
| `${os.arch}` | CPUアーキテクチャです。 | `arm64` |
| `${os.shell}` | 現在のシェルです。 | `/bin/zsh` |
| `${os.version}` | オペレーティングシステムのバージョン説明です。 | `Darwin Kernel Version ...` |
| `${os.release}` | オペレーティングシステムのリリースです。 | `24.5.0` |
| `${os.hostname}` | 現在のホスト名です。 | `MacBook-Pro.local` |
| `${os.availableParallelism}` | 利用可能な並列性です。 | `10` |
| `${os.totalMemory}` | システム総メモリ（バイト単位）です。 | `34359738368` |
| `${os.freeMemory}` | 空きメモリ（バイト単位）です。 | `8589934592` |
| `${os.uptime}` | システムアップタイム（秒単位）です。 | `123456` |

## Node.js ランタイム

| Variable | Description | Example |
|---|---|---|
| `${runtime.nodeVersion}` | 現在のNode.jsバージョンです。 | `v24.14.0` |
| `${runtime.execPath}` | 現在のNode.js実行可能ファイルへのパスです。 | `/opt/homebrew/bin/node` |
| `${runtime.pid}` | 現在のプロセスIDです。 | `12345` |
| `${runtime.ppid}` | 親プロセスIDです。 | `1234` |

## 時間

| Variable | Description | Example |
|---|---|---|
| `${time.current}` | 現在のローカル時刻文字列です。 | `Thu Jul 09 2026 18:22:09 GMT+0800 (China Standard Time)` |
| `${time.iso}` | 現在のISO時刻です。 | `2026-07-09T10:22:09.000Z` |
| `${time.date}` | 現在のローカル日付です。 | `2026-07-09` |
| `${time.timezone}` | 現在のシステムタイムゾーンです。 | `Asia/Shanghai` |

## 権限とサンドボックス

| Variable | Description | Example |
|---|---|---|
| `${permissions.mode}` | 現在のツール権限モードです。 | `default` |
| `${permissions.approvalsReviewer}` | 現在の承認ポリシーまたはレビュアーモードです。 | `auto_review` |
| `${sandbox.mode}` | ファイルシステムサンドボックスモードです。 | `workspace-write` |
| `${sandbox.networkAccess}` | ネットワークアクセスの状態です。 | `enabled` |
| `${sandbox.writableRoots}` | サンドボックスが書き込みを許可するディレクトリです。改行区切りの文字列として表示される場合があります。 | `/Users/sky/Documents/Playground` |

## ターミナル

| Variable | Description | Example |
|---|---|---|
| `${terminal.term}` | 現在のTERMです。 | `xterm-256color` |
| `${terminal.colorTerm}` | 現在のCOLORTERMです。 | `truecolor` |
| `${terminal.columns}` | 現在のターミナル列数です。 | `120` |
| `${terminal.rows}` | 現在のターミナル行数です。 | `40` |

## ファイルシステム

| Variable | Description | Example |
|---|---|---|
| `${filesystem.tmpdir}` | システム一時ディレクトリです。 | `/var/folders/.../T` |
| `${filesystem.pathSeparator}` | ファイルパス区切り記号です。 | `/` |
| `${filesystem.pathDelimiter}` | PATHエントリ区切り記号です。 | `:` |

## モデル

| Variable | Description | Example |
|---|---|---|
| `${model.name}` | 現在のモデル名またはIDです。 | `claude-opus-4-6` |
| `${model.knowledgeCutoff}` | 現在のモデルナレッジカットオフ。この値はオペレーティングシステムから導出することはできず、外部構成またはオーバーライドを通じて注入する必要があります。 | `May 2025` |

## Git

| Variable | Description | Example |
|---|---|---|
| `${git.isRepository}` | 現在のディレクトリがgitリポジトリ内にあるかどうかを、文字列で示します。 | `true` |
| `${git.root}` | Gitリポジトリのルートディレクトリです。 | `/Users/sky/project` |
| `${git.branch}` | 現在のgitブランチまたは短いHEADハッシュです。 | `main` |
| `${git.mainBranch}` | デフォルトのメインブランチで、通常PRまたはマージターゲットとして使用されます。 | `main` |
| `${git.userName}` | 現在のgit `user.name` です。 | `Sky` |
| `${git.status}` | `git status --short` の出力です。 | `M src/index.ts` |
| `${git.recentCommits}` | 最近のコミットの概要です。 | `abc1234 Fix prompt builder` |

## メモリ

メモリ変数は、永続的なファイルベースのメモリディレクトリを説明します。`CC_MEMORY_DIR` / `CLAUDE_MEMORY_DIR` オーバーライドが設定されている場合、`${memory.dir}` はそこから解決されます。そうでない場合は、`<home>/.claude/projects/<slug>/memory/` として計算されます。ここで `<slug>` はプライマリ作業ディレクトリで、すべての英数字以外の文字が `-` に置き換えられます。`${memory.index}` はそのディレクトリ内の `MEMORY.md` の内容を保持し（各セッションで読み込まれるインデックス）、`${memory.enabled}` はメモリが利用可能かどうかを報告します。`# Memory` および `# Memory index` セクションは、メモリが有効な場合にのみ組み立てられます。

| Variable | Description | Example |
|---|---|---|
| `${memory.dir}` | 解決されたメモリディレクトリです。 | `/Users/sky/.claude/projects/-Users-sky-project/memory/` |
| `${memory.index}` | `MEMORY.md` の内容、または存在しない場合は `""` です。 | `# Memory index\n- [Commit to main](commit-to-main.md) — hook` |
| `${memory.enabled}` | メモリが利用可能かどうかを、文字列で示します。 | `true` |

## スクラッチパッド

スクラッチパッドディレクトリはセッション固有であり、オペレーティングシステムから導出することはできません。`CC_SCRATCHPAD_DIR` / `CLAUDE_SCRATCHPAD_DIR` オーバーライドを通じて注入する必要があります。設定されていない場合は `""` にフォールバックし、`# Scratchpad Directory` セクションは組み立てから省略されます。

| Variable | Description | Example |
|---|---|---|
| `${scratchpad.dir}` | セッション固有の一時ディレクトリです。 | `/private/tmp/claude-501/<slug>/<session>/scratchpad` |
