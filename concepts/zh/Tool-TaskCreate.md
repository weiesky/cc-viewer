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

## 原文

<textarea readonly>Use this tool to create a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

## When to Use This Tool

Use this tool proactively in these scenarios:

- Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
- Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
- Plan mode - When using plan mode, create a task list to track the work
- User explicitly requests todo list - When the user directly asks you to use the todo list
- User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
- After receiving new instructions - Immediately capture user requirements as tasks
- When you start working on a task - Mark it as in_progress BEFORE beginning work
- After completing a task - Mark it as completed and add any new follow-up tasks discovered during implementation

## When NOT to Use This Tool

Skip using this tool when:
- There is only a single, straightforward task
- The task is trivial and tracking it provides no organizational benefit
- The task can be completed in less than 3 trivial steps
- The task is purely conversational or informational

NOTE that you should not use this tool if there is only one trivial task to do. In this case you are better off just doing the task directly.

## Task Fields

- **subject**: A brief, actionable title in imperative form (e.g., "Fix authentication bug in login flow")
- **description**: Detailed description of what needs to be done, including context and acceptance criteria
- **activeForm**: Present continuous form shown in spinner when task is in_progress (e.g., "Fixing authentication bug"). This is displayed to the user while you work on the task.

**IMPORTANT**: Always provide activeForm when creating tasks. The subject should be imperative ("Run tests") while activeForm should be present continuous ("Running tests"). All tasks are created with status `pending`.

## Tips

- Create tasks with clear, specific subjects that describe the outcome
- Include enough detail in the description for another agent to understand and complete the task
- After creating tasks, use TaskUpdate to set up dependencies (blocks/blockedBy) if needed
- Check TaskList first to avoid creating duplicate tasks
</textarea>
