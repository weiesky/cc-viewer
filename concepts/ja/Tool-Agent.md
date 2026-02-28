# Agent

## 定義

サブ agent（SubAgent）を起動して、複雑なマルチステップタスクを自律的に処理します。サブ agent は独立したサブプロセスで、それぞれ専用のツールセットとコンテキストを持ちます。Agent は新しい Claude Code バージョンにおける Task ツールのリネーム版です。

## パラメータ

| パラメータ | 型 | 必須 | 説明 |
|------------|------|------|------|
| `prompt` | string | はい | サブ agent が実行するタスクの説明 |
| `description` | string | はい | 3〜5語の短い要約 |
| `subagent_type` | string | はい | サブ agent タイプ、利用可能なツールセットを決定 |
| `model` | enum | いいえ | モデルを指定（sonnet / opus / haiku）、デフォルトは親から継承 |
| `max_turns` | integer | いいえ | 最大 agentic ターン数 |
| `run_in_background` | boolean | いいえ | バックグラウンドで実行するかどうか。バックグラウンドタスクは output_file パスを返す |
| `resume` | string | いいえ | 再開する agent ID、前回の実行から続行。コンテキストを失わずに以前のサブ agent を引き継ぐのに有用 |
| `isolation` | enum | いいえ | 隔離モード、`worktree` で一時的な git worktree を作成 |

## サブ agent タイプ

| タイプ | 用途 | 利用可能なツール |
|--------|------|------------------|
| `Bash` | コマンド実行、git 操作 | Bash |
| `general-purpose` | 汎用マルチステップタスク | 全ツール |
| `Explore` | コードベースの高速探索 | Agent/Edit/Write/NotebookEdit/ExitPlanMode 以外のすべて |
| `Plan` | 実装方針の設計 | Agent/Edit/Write/NotebookEdit/ExitPlanMode 以外のすべて |
| `claude-code-guide` | Claude Code 使用ガイド Q&A | Glob, Grep, Read, WebFetch, WebSearch |
| `statusline-setup` | ステータスバーの設定 | Read, Edit |

## 使用シナリオ

**適している場合：**
- マルチステップで自律的に完了する必要がある複雑なタスク
- コードベースの探索と深い調査（Explore タイプを使用）
- 隔離環境が必要な並列作業
- バックグラウンドで実行する必要がある長時間タスク

**適していない場合：**
- 特定のファイルパスの読み取り——直接 Read または Glob を使用
- 2〜3個の既知ファイル内の検索——直接 Read を使用
- 特定のクラス定義の検索——直接 Glob を使用

## 注意事項

- サブ agent は完了後に単一メッセージを返し、その結果はユーザーには見えないため、メイン agent が伝達する必要がある
- 単一メッセージ内で複数の並列 Agent 呼び出しを発行して効率を向上できる
- バックグラウンドタスクは TaskOutput ツールで進捗を確認
- Explore タイプは直接 Glob/Grep を呼び出すより遅いため、単純な検索では不十分な場合にのみ使用
- 長時間実行で即座に結果が不要なタスクには `run_in_background: true` を推奨。結果が必要な場合はフォアグラウンド（デフォルト）を使用
- `resume` パラメータにより、以前開始したサブ agent セッションを継続でき、蓄積されたコンテキストを保持

## cc-viewer での意義

Agent は新しい Claude Code バージョンにおける Task ツールの新名称です。Agent 呼び出しは SubAgent リクエストチェーンを生成し、リクエストリストで MainAgent とは独立したサブリクエストシーケンスとして確認できます。SubAgent リクエストは通常、簡潔な system prompt と少ないツール定義を持ち、MainAgent と明確な対比を形成します。cc-viewer では、記録された会話で使用された Claude Code のバージョンに応じて、`Task` または `Agent` のいずれかのツール名が表示される場合があります。
