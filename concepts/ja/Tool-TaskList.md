# TaskList

## 定義

タスクリスト内のすべてのタスクを一覧表示し、全体の進捗と利用可能な作業を確認します。

## パラメータ

パラメータなし。

## 返却内容

各タスクの要約情報：
- `id` — タスク識別子
- `subject` — 短い説明
- `status` — ステータス：`pending`、`in_progress` または `completed`
- `owner` — 担当者（agent ID）、空は未割り当て
- `blockedBy` — このタスクをブロックしている未完了タスク ID のリスト

## 使用シナリオ

**適している場合：**
- 利用可能なタスクの確認（ステータスが pending、owner なし、ブロックされていない）
- プロジェクト全体の進捗確認
- ブロックされているタスクの検索
- タスク完了後に次のタスクを検索

## 注意事項

- ID 順にタスクを処理することを優先（最小 ID 優先）。早期のタスクは通常、後続タスクにコンテキストを提供するため
- `blockedBy` があるタスクは依存が解除されるまで認領できない
- TaskGet で特定タスクの完全な詳細を取得

## cc-viewer での意義

TaskList は内部タスク管理操作であり、独立した API リクエストは生成しません。

## 原文

<textarea readonly>Use this tool to list all tasks in the task list.

## When to Use This Tool

- To see what tasks are available to work on (status: 'pending', no owner, not blocked)
- To check overall progress on the project
- To find tasks that are blocked and need dependencies resolved
- After completing a task, to check for newly unblocked work or claim the next available task
- **Prefer working on tasks in ID order** (lowest ID first) when multiple tasks are available, as earlier tasks often set up context for later ones

## Output

Returns a summary of each task:
- **id**: Task identifier (use with TaskGet, TaskUpdate)
- **subject**: Brief description of the task
- **status**: 'pending', 'in_progress', or 'completed'
- **owner**: Agent ID if assigned, empty if available
- **blockedBy**: List of open task IDs that must be resolved first (tasks with blockedBy cannot be claimed until dependencies resolve)

Use TaskGet with a specific task ID to view full details including description and comments.
</textarea>
