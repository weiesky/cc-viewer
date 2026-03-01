# TaskUpdate

## 定义

更新任务列表中某个任务的状态、内容或依赖关系。

## 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `taskId` | string | 是 | 要更新的任务 ID |
| `status` | enum | 否 | 新状态：`pending` / `in_progress` / `completed` / `deleted` |
| `subject` | string | 否 | 新标题 |
| `description` | string | 否 | 新描述 |
| `activeForm` | string | 否 | 进行中时显示的现在进行时文本 |
| `owner` | string | 否 | 新的任务负责人（agent 名称） |
| `metadata` | object | 否 | 要合并的元数据（设为 null 可删除键） |
| `addBlocks` | string[] | 否 | 被此任务阻塞的任务 ID 列表 |
| `addBlockedBy` | string[] | 否 | 阻塞此任务的前置任务 ID 列表 |

## 状态流转

```
pending → in_progress → completed
```

`deleted` 可从任何状态转入，永久移除任务。

## 使用场景

**适合使用：**
- 开始工作时标记任务为 `in_progress`
- 完成工作后标记任务为 `completed`
- 设置任务间的依赖关系
- 需求变更时更新任务内容

**重要规则：**
- 只有在完全完成任务时才标记为 `completed`
- 遇到错误或阻塞时保持 `in_progress`
- 测试失败、实现不完整、遇到未解决错误时不得标记为 `completed`

## 注意事项

- 更新前应先通过 TaskGet 获取任务最新状态，避免过期数据
- 完成任务后调用 TaskList 查找下一个可用任务

## 在 cc-viewer 中的意义

TaskUpdate 是内部任务管理操作，不产生独立的 API 请求。

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
