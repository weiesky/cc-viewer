# TaskUpdate

## 定義

タスクリスト内の特定タスクのステータス、内容、または依存関係を更新します。

## パラメータ

| パラメータ | 型 | 必須 | 説明 |
|------------|------|------|------|
| `taskId` | string | はい | 更新するタスクの ID |
| `status` | enum | いいえ | 新しいステータス：`pending` / `in_progress` / `completed` / `deleted` |
| `subject` | string | いいえ | 新しいタイトル |
| `description` | string | いいえ | 新しい説明 |
| `activeForm` | string | いいえ | 進行中に表示する現在進行形テキスト |
| `owner` | string | いいえ | 新しいタスク担当者（agent 名） |
| `metadata` | object | いいえ | マージするメタデータ（null に設定するとキーを削除） |
| `addBlocks` | string[] | いいえ | このタスクによってブロックされるタスク ID のリスト |
| `addBlockedBy` | string[] | いいえ | このタスクをブロックする前提タスク ID のリスト |

## ステータス遷移

```
pending → in_progress → completed
```

`deleted` は任意のステータスから遷移可能で、タスクを永久に削除します。

## 使用シナリオ

**適している場合：**
- 作業開始時にタスクを `in_progress` にマーク
- 作業完了後にタスクを `completed` にマーク
- タスク間の依存関係を設定
- 要件変更時にタスク内容を更新

**重要なルール：**
- タスクを完全に完了した場合のみ `completed` にマーク
- エラーやブロックに遭遇した場合は `in_progress` を維持
- テスト失敗、実装不完全、未解決エラーがある場合は `completed` にマークしてはならない

## 注意事項

- 更新前に TaskGet でタスクの最新ステータスを取得し、古いデータを避ける
- タスク完了後に TaskList を呼び出して次の利用可能なタスクを検索

## cc-viewer での意義

TaskUpdate は内部タスク管理操作であり、独立した API リクエストは生成しません。

## 原文

<textarea readonly>Use this tool to update a task in the task list.

## When to Use This Tool

**Mark tasks as resolved:**
- When you have completed the work described in a task
- When a task is no longer needed or has been superseded
- IMPORTANT: Always mark your assigned tasks as resolved when you finish them
- After resolving, call TaskList to find your next task

- ONLY mark a task as completed when you have FULLY accomplished it
- If you encounter errors, blockers, or cannot finish, keep the task as in_progress
- When blocked, create a new task describing what needs to be resolved
- Never mark a task as completed if:
  - Tests are failing
  - Implementation is partial
  - You encountered unresolved errors
  - You couldn't find necessary files or dependencies

**Delete tasks:**
- When a task is no longer relevant or was created in error
- Setting status to `deleted` permanently removes the task

**Update task details:**
- When requirements change or become clearer
- When establishing dependencies between tasks

## Fields You Can Update

- **status**: The task status (see Status Workflow below)
- **subject**: Change the task title (imperative form, e.g., "Run tests")
- **description**: Change the task description
- **activeForm**: Present continuous form shown in spinner when in_progress (e.g., "Running tests")
- **owner**: Change the task owner (agent name)
- **metadata**: Merge metadata keys into the task (set a key to null to delete it)
- **addBlocks**: Mark tasks that cannot start until this one completes
- **addBlockedBy**: Mark tasks that must complete before this one can start

## Status Workflow

Status progresses: `pending` → `in_progress` → `completed`

Use `deleted` to permanently remove a task.

## Staleness

Make sure to read a task's latest state using `TaskGet` before updating it.

## Examples

Mark task as in progress when starting work:
```json
{"taskId": "1", "status": "in_progress"}
```

Mark task as completed after finishing work:
```json
{"taskId": "1", "status": "completed"}
```

Delete a task:
```json
{"taskId": "1", "status": "deleted"}
```

Claim a task by setting owner:
```json
{"taskId": "1", "owner": "my-name"}
```

Set up task dependencies:
```json
{"taskId": "2", "addBlockedBy": ["1"]}
```
</textarea>
