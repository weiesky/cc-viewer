# TaskGet

## 定義

タスク ID でタスクの完全な詳細を取得します。

## パラメータ

| パラメータ | 型 | 必須 | 説明 |
|------------|------|------|------|
| `taskId` | string | はい | 取得するタスクの ID |

## 返却内容

- `subject` — タスクタイトル
- `description` — 詳細な要件とコンテキスト
- `status` — ステータス：`pending`、`in_progress` または `completed`
- `blocks` — このタスクによってブロックされているタスクのリスト
- `blockedBy` — このタスクをブロックしている前提タスクのリスト

## 使用シナリオ

**適している場合：**
- 作業開始前にタスクの完全な説明とコンテキストを取得
- タスクの依存関係を理解
- タスクを割り当てられた後に完全な要件を取得

## 注意事項

- タスク取得後、作業開始前に `blockedBy` リストが空であることを確認すべき
- TaskList ですべてのタスクの要約情報を確認

## cc-viewer での意義

TaskGet は内部タスク管理操作であり、独立した API リクエストは生成しません。

## 原文

<textarea readonly>Use this tool to retrieve a task by its ID from the task list.

## When to Use This Tool

- When you need the full description and context before starting work on a task
- To understand task dependencies (what it blocks, what blocks it)
- After being assigned a task, to get complete requirements

## Output

Returns full task details:
- **subject**: Task title
- **description**: Detailed requirements and context
- **status**: 'pending', 'in_progress', or 'completed'
- **blocks**: Tasks waiting on this one to complete
- **blockedBy**: Tasks that must complete before this one can start

## Tips

- After fetching a task, verify its blockedBy list is empty before beginning work.
- Use TaskList to see all tasks in summary form.
</textarea>
