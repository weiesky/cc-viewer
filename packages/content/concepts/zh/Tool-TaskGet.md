# TaskGet

根据 ID 获取单个任务的完整记录，包括描述、当前状态、owner、metadata 和依赖边。当 `TaskList` 的摘要不足以采取行动时使用它。

## 何时使用

- 你从 `TaskList` 挑中某任务，需要在开始前阅读完整描述。
- 你即将把任务标记为 `completed`，想再次核对验收标准。
- 你需要检查本任务 `blocks` 或 `blockedBy` 哪些任务，以决定下一步。
- 你在调查历史——谁拥有它、附了什么 metadata、何时变更状态。
- 队友或此前的会话提到某任务 ID，你需要其上下文。

仅需高层次扫视时优先使用 `TaskList`；要仔细阅读或修改特定记录时才使用 `TaskGet`。

## 启用方式

- 在大多数模型上默认可用。
- 在 Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 及更高版本家族（v2.1.233+）上不可用，除非通过 `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`、`--allowedTools` 或 `--tools` 选择启用。
- 当 `CLAUDE_CODE_ENABLE_TASKS=false` 时，整个任务系统被禁用。

## 参数

- `taskId` (string, 必填)：由 `TaskCreate` 或 `TaskList` 返回的任务标识符。ID 在任务生命周期内稳定。

## 示例

### 示例 1

查看你刚在列表中看到的任务。

```
TaskGet(taskId: "t_01HXYZ...")
```

典型响应字段：`id`、`subject`、`description`、`activeForm`、`status`、`owner`、`blocks`、`blockedBy`、`metadata`、`createdAt`、`updatedAt`。

### 示例 2

开始前解析依赖。

```
TaskGet(taskId: "t_01HXYZ...")
# 检查 blockedBy —— 若其中任一任务仍为 pending
# 或 in_progress，先处理前置任务。
```

## 注意事项

- `TaskGet` 是只读的，可安全地反复调用；它不会改变状态或归属。
- 若 `blockedBy` 非空且包含尚未 `completed` 的任务，不要开始本任务——先解决前置（或与其 owner 协调）。
- `description` 字段可能很长。行动前完整阅读；跳读会遗漏验收标准。
- 未知或已删除的 `taskId` 会返回错误。重新运行 `TaskList` 以拿到现行 ID。
- 如果你即将编辑一个任务，先调用 `TaskGet`，避免覆盖队友刚改过的字段。
