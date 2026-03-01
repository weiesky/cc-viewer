# TaskStop

## 定义

停止一个正在运行的后台任务。

## 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `task_id` | string | 否 | 要停止的后台任务 ID |
| `shell_id` | string | 否 | 已弃用，使用 `task_id` 代替 |

## 使用场景

**适合使用：**
- 终止不再需要的长时间运行任务
- 取消错误启动的后台任务

## 注意事项

- 返回成功或失败状态
- `shell_id` 参数已弃用，应使用 `task_id`

## 在 cc-viewer 中的意义

TaskStop 调用本身不产生 API 请求，属于 Claude Code 内部任务管理操作。

## 原文

<textarea readonly>
- Stops a running background task by its ID
- Takes a task_id parameter identifying the task to stop
- Returns a success or failure status
- Use this tool when you need to terminate a long-running task
</textarea>
