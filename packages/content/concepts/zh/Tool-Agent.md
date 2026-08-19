# Agent

派生一个拥有独立上下文窗口的 Claude Code 自主子代理，用于处理聚焦型任务并返回单一的整合结果。这是委派开放式调研、并行工作或团队协作的标准机制。

## 何时使用

- 开放式搜索，当你尚不清楚哪些文件相关，并预计需要多轮 `Glob`、`Grep` 和 `Read` 时。
- 并行独立工作——在一条消息中启动多个代理，并发调查不同领域。
- 将噪声较大的探索与主对话隔离，使父级上下文保持精简。
- 委派给 `Explore`、`Plan`、`claude-code-guide` 或 `statusline-setup` 等专门的子代理类型。
- 在活跃团队中派生具名队友，以开展协调的多代理协作。

当目标文件或符号已知时，不要使用本工具——直接使用 `Read`、`Grep` 或 `Glob`。通过 `Agent` 进行单步查找会浪费整个上下文窗口并增加延迟。

## 参数

- `description` (string, 必填)：3-5 个词的简短标签，用于描述任务；显示在 UI 与日志中。
- `prompt` (string, 必填)：代理将执行的完整、自包含的任务说明。必须包含所有必要的上下文、约束条件以及期望的返回格式。
- `subagent_type` (string, 可选)：预设的角色，如 `general-purpose`、`Explore`、`Plan`、`claude-code-guide` 或 `statusline-setup`。默认为 `general-purpose`。
- `run_in_background` (boolean, 可选)：为 true 时，代理异步运行，父级可继续工作；结果稍后再获取。
- `model` (string, 可选)：为该代理覆盖模型——`opus`、`sonnet` 或 `haiku`。默认使用父会话模型。
- `isolation` (string, 可选)：设为 `worktree` 可让代理在隔离的 git worktree 中运行，避免其文件写入与父级冲突。
- `team_name` (string, 可选)：派生到已有团队时，代理将加入的团队标识符。
- `name` (string, 可选)：队友在团队内可寻址的名称，用作 `SendMessage` 的 `to` 目标。

## 示例

### 示例 1：开放式代码搜索

```
Agent(
  description="Find auth middleware",
  subagent_type="Explore",
  prompt="Locate every place in this repo where JWT verification is performed. Return a bulleted list of absolute file paths with a one-line note about each site's role. Do not modify any files."
)
```

### 示例 2：并行独立调查

在同一条消息中启动两个代理——一个检查构建流水线，一个审查测试框架。每个代理拥有独立的上下文窗口并返回摘要。在单个工具调用块中批量发起可让它们并发执行。

### 示例 3：将队友派生到运行中的团队

```
Agent(
  description="Data layer specialist",
  team_name="refactor-crew",
  name="db-lead",
  prompt="You are db-lead on team refactor-crew. Audit all Prisma schema files and propose a migration plan. Use SendMessage to report findings to the team leader."
)
```

## 注意事项

- 代理没有历史记忆。每次调用都从零开始，因此 `prompt` 必须完全自包含——包含文件路径、约定、问题以及你希望收到的确切答案形式。
- 代理仅返回一条最终消息。它无法在运行中途提出澄清问题，因此提示中的歧义会导致结果靠猜测。
- 并行运行多个代理在子任务彼此独立时，比串行调用快得多。请在单个工具调用块中批量发起。
- 当代理需要写入文件，且你希望在并入主工作树前审阅改动时，请使用 `isolation: "worktree"`。
- 只读侦察优先选择 `subagent_type: "Explore"`，设计工作选择 `Plan`；`general-purpose` 是读写混合任务的默认选项。
- 后台代理（`run_in_background: true`）适合长时间运行的任务；不要在 sleep 循环中轮询——父级会在完成时收到通知。
