# TaskList

## 定義

列出任務列表中的所有任務，查看整體進度和可用工作。

## 參數

無參數。

## 回傳內容

每個任務的摘要資訊：
- `id` — 任務識別碼
- `subject` — 簡短描述
- `status` — 狀態：`pending`、`in_progress` 或 `completed`
- `owner` — 負責人（agent ID），空表示未分配
- `blockedBy` — 阻塞此任務的未完成任務 ID 列表

## 使用場景

**適合使用：**
- 查看有哪些可用任務（狀態為 pending、無 owner、未被阻塞）
- 檢查專案整體進度
- 查找被阻塞的任務
- 完成一個任務後查找下一個

## 注意事項

- 優先按 ID 順序處理任務（最小 ID 優先），因為早期任務通常為後續任務提供上下文
- 有 `blockedBy` 的任務在依賴解除前不能認領
- 使用 TaskGet 取得特定任務的完整詳情

## 在 cc-viewer 中的意義

TaskList 是內部任務管理操作，不產生獨立的 API 請求。

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
