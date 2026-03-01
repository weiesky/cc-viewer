# TaskList

## 定义

列出任务列表中的所有任务，查看整体进度和可用工作。

## 参数

无参数。

## 返回内容

每个任务的摘要信息：
- `id` — 任务标识符
- `subject` — 简短描述
- `status` — 状态：`pending`、`in_progress` 或 `completed`
- `owner` — 负责人（agent ID），空表示未分配
- `blockedBy` — 阻塞此任务的未完成任务 ID 列表

## 使用场景

**适合使用：**
- 查看有哪些可用任务（状态为 pending、无 owner、未被阻塞）
- 检查项目整体进度
- 查找被阻塞的任务
- 完成一个任务后查找下一个

## 注意事项

- 优先按 ID 顺序处理任务（最小 ID 优先），因为早期任务通常为后续任务提供上下文
- 有 `blockedBy` 的任务在依赖解除前不能认领
- 使用 TaskGet 获取特定任务的完整详情

## 在 cc-viewer 中的意义

TaskList 是内部任务管理操作，不产生独立的 API 请求。

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
