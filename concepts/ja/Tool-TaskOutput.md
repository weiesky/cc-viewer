# TaskOutput

## 定義

実行中または完了したバックグラウンドタスクの出力を取得します。バックグラウンドシェル、非同期 agent、リモートセッションに適用。

## パラメータ

| パラメータ | 型 | 必須 | 説明 |
|------------|------|------|------|
| `task_id` | string | はい | タスク ID |
| `block` | boolean | はい | タスク完了までブロック待機するかどうか、デフォルト `true` |
| `timeout` | number | はい | 最大待機時間（ミリ秒）、デフォルト 30000、最大 600000 |

## 使用シナリオ

**適している場合：**
- Task（`run_in_background: true`）で起動したバックグラウンド agent の進捗確認
- バックグラウンド Bash コマンドの実行結果を取得
- 非同期タスクの完了を待って出力を取得

**適していない場合：**
- フォアグラウンドタスク——フォアグラウンドタスクは直接結果を返すため、このツールは不要

## 注意事項

- `block: true` はタスク完了またはタイムアウトまでブロック
- `block: false` はノンブロッキングで現在の状態を確認
- タスク ID は `/tasks` コマンドで検索可能
- すべてのタスクタイプに適用：バックグラウンドシェル、非同期 agent、リモートセッション

## cc-viewer での意義

TaskOutput 呼び出し自体は API リクエストを生成しません。Claude Code 内部のタスク管理操作であり、リクエストログには表示されません。

## 原文

<textarea readonly>- Retrieves output from a running or completed task (background shell, agent, or remote session)
- Takes a task_id parameter identifying the task
- Returns the task output along with status information
- Use block=true (default) to wait for task completion
- Use block=false for non-blocking check of current status
- Task IDs can be found using the /tasks command
- Works with all task types: background shells, async agents, and remote sessions</textarea>
