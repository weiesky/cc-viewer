# TaskGet

## 定义

通过任务 ID 获取任务的完整详情。

## 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `taskId` | string | 是 | 要获取的任务 ID |

## 返回内容

- `subject` — 任务标题
- `description` — 详细需求和上下文
- `status` — 状态：`pending`、`in_progress` 或 `completed`
- `blocks` — 被此任务阻塞的任务列表
- `blockedBy` — 阻塞此任务的前置任务列表

## 使用场景

**适合使用：**
- 开始工作前获取任务的完整描述和上下文
- 了解任务的依赖关系
- 被分配任务后获取完整需求

## 注意事项

- 获取任务后应检查 `blockedBy` 列表是否为空再开始工作
- 使用 TaskList 查看所有任务的摘要信息

## 在 cc-viewer 中的意义

TaskGet 是内部任务管理操作，不产生独立的 API 请求。

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
