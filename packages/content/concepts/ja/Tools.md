# Claude Code ツール一覧

Claude Code は Anthropic API の tool_use メカニズムを通じてモデルに一連の組み込みツールを提供します。各 MainAgent リクエストの `tools` 配列にこれらのツールの完全な JSON Schema 定義が含まれ、モデルはレスポンス内の `tool_use` content block でそれらを呼び出します。

以下はすべてのツールのカテゴリ別インデックスです。

## Agent システム

| ツール | 用途 |
|--------|------|
| [Agent](Tool-Agent.md) | サブ agent（SubAgent）を起動して複雑なマルチステップタスクを処理 |
| [TaskOutput](Tool-TaskOutput.md) | バックグラウンドタスクの出力を取得 |
| [TaskStop](Tool-TaskStop.md) | 実行中のバックグラウンドタスクを停止 |
| [TaskCreate](Tool-TaskCreate.md) | 構造化タスクリストエントリを作成 |
| [TaskGet](Tool-TaskGet.md) | タスクの詳細を取得 |
| [TaskUpdate](Tool-TaskUpdate.md) | タスクのステータス、依存関係などを更新 |
| [TaskList](Tool-TaskList.md) | すべてのタスクを一覧表示 |
| [ListAgents](Tool-ListAgents.md) | セッションで利用可能な agent を一覧表示 |

## ファイル操作

| ツール | 用途 |
|--------|------|
| [Read](Tool-Read.md) | ファイル内容を読み取り（テキスト、画像、PDF、Jupyter notebook 対応） |
| [Edit](Tool-Edit.md) | 精確な文字列置換でファイルを編集 |
| [Write](Tool-Write.md) | ファイルの書き込みまたは上書き |
| [NotebookEdit](Tool-NotebookEdit.md) | Jupyter notebook セルの編集 |

## チーム & オーケストレーション

| ツール | 用途 |
|--------|------|
| [SendMessage](Tool-SendMessage.md) | 別の agent にメッセージを送信 |
| [Workflow](Tool-Workflow.md) | 決定論的なマルチエージェントオーケストレーションスクリプトを実行 |
| [Monitor](Tool-Monitor.md) | 長時間実行スクリプトのイベントを通知としてストリーミング |
| [SendFile](Tool-SendFile.md) | 別の Claude Code セッションにファイルを送信 |
| [SendUserFile](Tool-SendUserFile.md) | ユーザーにファイルを送信 |
| [SendUserMessage](Tool-SendUserMessage.md) | ユーザーにメッセージを送信（旧 Brief ツール） |
| [EndConversation](Tool-EndConversation.md) | 現在の会話を終了 |

## 検索

| ツール | 用途 |
|--------|------|
| [Glob](Tool-Glob.md) | ファイル名パターンマッチングでファイルを検索 |
| [Grep](Tool-Grep.md) | ripgrep ベースのファイル内容検索 |
| [ToolSearch](Tool-ToolSearch.md) | オンデマンドで遅延/MCP ツールを検索してロード |

## ターミナル

| ツール | 用途 |
|--------|------|
| [Bash](Tool-Bash.md) | シェルコマンドの実行 |
| [REPL](Tool-REPL.md) | 永続的な Node.js REPL で JavaScript を実行 |

## Web

| ツール | 用途 |
|--------|------|
| [WebFetch](Tool-WebFetch.md) | ウェブページの内容を取得し AI で処理 |
| [WebSearch](Tool-WebSearch.md) | 検索エンジンクエリ |
| [Artifact](Tool-Artifact.md) | HTML/Markdown ファイルをホストされた claude.ai ウェブページとして発行 |
| [DesignSync](Tool-DesignSync.md) | ローカルコンポーネントライブラリを claude.ai 設計システムプロジェクトと同期 |

## 計画とインタラクション

| ツール | 用途 |
|--------|------|
| [EnterPlanMode](Tool-EnterPlanMode.md) | 計画モードに入り、実装方針を設計 |
| [ExitPlanMode](Tool-ExitPlanMode.md) | 計画モードを終了し、方針をユーザー承認に提出 |
| [AskUserQuestion](Tool-AskUserQuestion.md) | ユーザーに質問して確認や判断を取得 |
| [ReportFindings](Tool-ReportFindings.md) | コードレビューの発見をホスト UI の型指定リストとして報告 |
| [TodoWrite](Tool-TodoWrite.md) | セッション用の構造化 todo リストを作成 |
| [SendFeedback](Tool-SendFeedback.md) | Claude Code に関する構造化フィードバックを Anthropic に送信 |
| [Projects](Tool-Projects.md) | プロジェクトのナレッジベースドキュメントを管理 |
| [ProposeGoal](Tool-ProposeGoal.md) | セッションの検証可能な完了ゴールを提案 |

## Worktrees

| ツール | 用途 |
|--------|------|
| [EnterWorktree](Tool-EnterWorktree.md) | セッション用の隔離された git worktree を作成または開始 |
| [ExitWorktree](Tool-ExitWorktree.md) | worktree セッションを終了し、保持または削除 |

## スケジューリング & 通知

| ツール | 用途 |
|--------|------|
| [CronCreate](Tool-CronCreate.md) | cron 式でプロンプトをスケジュール (反復または 1 回限り) |
| [CronDelete](Tool-CronDelete.md) | スケジュール済みの cron ジョブをキャンセル |
| [CronList](Tool-CronList.md) | スケジュール済みの cron ジョブを一覧表示 |
| [ScheduleWakeup](Tool-ScheduleWakeup.md) | 次のウェイクアップをスケジュールして /loop イテレーションを自動調整 |
| [PushNotification](Tool-PushNotification.md) | ユーザーにデスクトップ/モバイル通知を送信 |
| [RemoteTrigger](Tool-RemoteTrigger.md) | claude.ai リモートトリガールーチンを管理 |
| [ReadNotifications](Tool-ReadNotifications.md) | 保留中のセッション通知を読み取り |

## 拡張

| ツール | 用途 |
|--------|------|
| [Skill](Tool-Skill.md) | スキル（slash command）の実行 |

## MCP と拡張機能

| ツール | 用途 |
|--------|------|
| [ListMcpResources](Tool-ListMcpResources.md) | 接続中の MCP サーバーが公開するリソースを一覧表示 |
| [ReadMcpResource](Tool-ReadMcpResource.md) | URI で単一の MCP サーバーリソースを読み取り |
| [ReadMcpResourceDir](Tool-ReadMcpResourceDir.md) | URI でディレクトリ型 MCP リソースを一覧表示 |
| [SearchMcpRegistry](Tool-SearchMcpRegistry.md) | MCP コネクタレジストリをキーワードで検索 |
| [SuggestConnectors](Tool-SuggestConnectors.md) | レジストリ検索結果からコネクタの詳細を解決 |
| [ListConnectors](Tool-ListConnectors.md) | インストール済み MCP コネクタを一覧表示 |
| [SuggestPluginInstall](Tool-SuggestPluginInstall.md) | インラインプラグインインストールカードを表示 |
| [SuggestSkills](Tool-SuggestSkills.md) | 追加可能なスキルのカードを表示 |
| [ListPlugins](Tool-ListPlugins.md) | 有効な claude.ai プラグインを一覧表示 |
| [ListSkills](Tool-ListSkills.md) | 有効な claude.ai スキルを一覧表示 |

## IDE 統合

| ツール | 用途 |
|--------|------|
| [LSP](Tool-LSP.md) | 言語サーバークエリ (定義、参照、シンボル) |
