# TaskCreate

## 定义

创建结构化的任务列表条目，用于跟踪进度、组织复杂任务，并向用户展示工作进展。

## 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `subject` | string | 是 | 简短的任务标题，使用祈使句（如 "Fix authentication bug"） |
| `description` | string | 是 | 详细描述，包含上下文和验收标准 |
| `activeForm` | string | 否 | 进行中时显示的现在进行时文本（如 "Fixing authentication bug"） |
| `metadata` | object | 否 | 附加到任务的任意元数据 |

## 使用场景

**适合使用：**
- 复杂的多步骤任务（3 步以上）
- 用户提供了多个待办事项
- 在规划模式中跟踪工作
- 用户明确要求使用 todo 列表

**不适合使用：**
- 单一简单任务
- 3 步以内的简单操作
- 纯对话或信息查询

## 注意事项

- 所有新建任务的初始状态为 `pending`
- `subject` 使用祈使句（"Run tests"），`activeForm` 使用现在进行时（"Running tests"）
- 创建任务后可通过 TaskUpdate 设置依赖关系（blocks/blockedBy）
- 创建前应先调用 TaskList 检查是否有重复任务

## 在 cc-viewer 中的意义

TaskCreate 是 Claude Code 内部的任务管理操作，不产生独立的 API 请求。但在 Chat Mode 中可以看到模型调用此工具的 tool_use block。
