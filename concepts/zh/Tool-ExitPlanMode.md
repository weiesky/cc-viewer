# ExitPlanMode

## 定义

退出规划模式并将方案提交给用户审批。方案内容从之前写入的计划文件中读取。

## 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `allowedPrompts` | array | 否 | 实施方案所需的权限描述列表 |

`allowedPrompts` 数组中每个元素：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `tool` | enum | 是 | 适用的工具，目前仅支持 `Bash` |
| `prompt` | string | 是 | 操作的语义描述（如 "run tests"、"install dependencies"） |

## 使用场景

**适合使用：**
- 规划模式中方案已完成，准备提交用户审批
- 仅用于需要编写代码的实施任务

**不适合使用：**
- 纯研究/探索任务——不需要退出规划模式
- 想问用户"方案可以吗？"——这正是此工具的功能，不要用 AskUserQuestion 来问

## 注意事项

- 此工具不接受方案内容作为参数——它从之前写入的计划文件中读取
- 用户会看到计划文件的内容来审批
- 不要在调用此工具前用 AskUserQuestion 问"方案是否可以"，这是重复的
- 不要在问题中提及"计划"，因为用户在 ExitPlanMode 之前看不到计划内容

## 在 cc-viewer 中的意义

ExitPlanMode 调用标志着规划阶段的结束。在请求日志中，此调用之后的请求通常转为实施性操作（Edit、Write、Bash 等）。

## 原文

<textarea readonly>Use this tool when you are in plan mode and have finished writing your plan to the plan file and are ready for user approval.

## How This Tool Works
- You should have already written your plan to the plan file specified in the plan mode system message
- This tool does NOT take the plan content as a parameter - it will read the plan from the file you wrote
- This tool simply signals that you're done planning and ready for the user to review and approve
- The user will see the contents of your plan file when they review it

## When to Use This Tool
IMPORTANT: Only use this tool when the task requires planning the implementation steps of a task that requires writing code. For research tasks where you're gathering information, searching files, reading files or in general trying to understand the codebase - do NOT use this tool.

## Before Using This Tool
Ensure your plan is complete and unambiguous:
- If you have unresolved questions about requirements or approach, use AskUserQuestion first (in earlier phases)
- Once your plan is finalized, use THIS tool to request approval

**Important:** Do NOT use AskUserQuestion to ask "Is this plan okay?" or "Should I proceed?" - that's exactly what THIS tool does. ExitPlanMode inherently requests user approval of your plan.

## Examples

1. Initial task: "Search for and understand the implementation of vim mode in the codebase" - Do not use the exit plan mode tool because you are not planning the implementation steps of a task.
2. Initial task: "Help me implement yank mode for vim" - Use the exit plan mode tool after you have finished planning the implementation steps of the task.
3. Initial task: "Add a new feature to handle user authentication" - If unsure about auth method (OAuth, JWT, etc.), use AskUserQuestion first, then use exit plan mode tool after clarifying the approach.
</textarea>
