# Claude Code ツール一覧

Claude Code は Anthropic API の tool_use メカニズムを通じてモデルに一連の組み込みツールを提供します。各 MainAgent リクエストの `tools` 配列にこれらのツールの完全な JSON Schema 定義が含まれ、モデルはレスポンス内の `tool_use` content block でそれらを呼び出します。

以下はすべてのツールのカテゴリ別インデックスです。

## Agent システム

| ツール | 用途 |
|--------|------|
| [Task](Tool-Task.md) | サブ agent（SubAgent）を起動して複雑なマルチステップタスクを処理 |
| [TaskOutput](Tool-TaskOutput.md) | バックグラウンドタスクの出力を取得 |
| [TaskStop](Tool-TaskStop.md) | 実行中のバックグラウンドタスクを停止 |
| [TaskCreate](Tool-TaskCreate.md) | 構造化タスクリストエントリを作成 |
| [TaskGet](Tool-TaskGet.md) | タスクの詳細を取得 |
| [TaskUpdate](Tool-TaskUpdate.md) | タスクのステータス、依存関係などを更新 |
| [TaskList](Tool-TaskList.md) | すべてのタスクを一覧表示 |

## ファイル操作

| ツール | 用途 |
|--------|------|
| [Read](Tool-Read.md) | ファイル内容を読み取り（テキスト、画像、PDF、Jupyter notebook 対応） |
| [Edit](Tool-Edit.md) | 精確な文字列置換でファイルを編集 |
| [Write](Tool-Write.md) | ファイルの書き込みまたは上書き |
| [NotebookEdit](Tool-NotebookEdit.md) | Jupyter notebook セルの編集 |

## 検索

| ツール | 用途 |
|--------|------|
| [Glob](Tool-Glob.md) | ファイル名パターンマッチングでファイルを検索 |
| [Grep](Tool-Grep.md) | ripgrep ベースのファイル内容検索 |

## ターミナル

| ツール | 用途 |
|--------|------|
| [Bash](Tool-Bash.md) | シェルコマンドの実行 |

## Web

| ツール | 用途 |
|--------|------|
| [WebFetch](Tool-WebFetch.md) | ウェブページの内容を取得し AI で処理 |
| [WebSearch](Tool-WebSearch.md) | 検索エンジンクエリ |

## 計画とインタラクション

| ツール | 用途 |
|--------|------|
| [EnterPlanMode](Tool-EnterPlanMode.md) | 計画モードに入り、実装方針を設計 |
| [ExitPlanMode](Tool-ExitPlanMode.md) | 計画モードを終了し、方針をユーザー承認に提出 |
| [AskUserQuestion](Tool-AskUserQuestion.md) | ユーザーに質問して確認や判断を取得 |

## 拡張

| ツール | 用途 |
|--------|------|
| [Skill](Tool-Skill.md) | スキル（slash command）の実行 |

## IDE 統合

| ツール | 用途 |
|--------|------|
| [getDiagnostics](Tool-getDiagnostics.md) | VS Code 言語診断情報の取得 |
| [executeCode](Tool-executeCode.md) | Jupyter kernel でコードを実行 |
