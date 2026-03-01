# TaskStop

## 定義

実行中のバックグラウンドタスクを停止します。

## パラメータ

| パラメータ | 型 | 必須 | 説明 |
|------------|------|------|------|
| `task_id` | string | いいえ | 停止するバックグラウンドタスクの ID |
| `shell_id` | string | いいえ | 非推奨、`task_id` を代わりに使用 |

## 使用シナリオ

**適している場合：**
- 不要になった長時間実行タスクの終了
- 誤って起動したバックグラウンドタスクのキャンセル

## 注意事項

- 成功または失敗のステータスを返す
- `shell_id` パラメータは非推奨、`task_id` を使用すべき

## cc-viewer での意義

TaskStop 呼び出し自体は API リクエストを生成しません。Claude Code 内部のタスク管理操作です。

## 原文

<textarea readonly>
- Stops a running background task by its ID
- Takes a task_id parameter identifying the task to stop
- Returns a success or failure status
- Use this tool when you need to terminate a long-running task
</textarea>
