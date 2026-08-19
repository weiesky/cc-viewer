# TaskList

以摘要形式返回当前团队（或会话）中的每个任务。用它概览未完成的工作、决定下一步做什么并避免重复创建。

## 何时使用

- 会话伊始，查看已跟踪的内容。
- 调用 `TaskCreate` 之前，确认工作尚未被记录。
- 作为队友或子代理，决定接下来认领哪个任务。
- 一眼核对整个团队的依赖关系。
- 在长会话中周期性重新同步，避免遗漏队友期间认领、完成或新增的任务。

`TaskList` 只读且成本低；需要概览时随时调用。

## 启用方式

- 在大多数模型上默认可用。
- 在 Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 及更高版本家族（v2.1.233+）上不可用，除非通过 `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`、`--allowedTools` 或 `--tools` 选择启用。
- 当 `CLAUDE_CODE_ENABLE_TASKS=false` 时，整个任务系统被禁用。

## 参数

`TaskList` 无参数。它总是返回当前上下文中的全量任务集合。

## 响应形态

列表中的每个任务都是摘要，而非完整记录。大致包括：

- `id` —— 供 `TaskGet` / `TaskUpdate` 使用的稳定标识符。
- `subject` —— 简短的祈使式标题。
- `status` —— `pending`、`in_progress`、`completed`、`deleted` 之一。
- `owner` —— 代理或队友 handle，未认领时为空。
- `blockedBy` —— 必须先完成的任务 ID 数组。

若需要某任务的完整描述、验收标准或 metadata，后续再调用 `TaskGet`。

## 示例

### 示例 1

快速状态检查。

```
TaskList()
```

扫描输出，找出无 `owner` 却处于 `in_progress` 的（陈旧工作），以及 `blockedBy` 为空且处于 `pending` 的（可认领）。

### 示例 2

队友挑选下一个任务。

```
TaskList()
# 过滤：status == pending 且 blockedBy 为空且 owner 为空。
# 在这些之中，偏向较低 ID（任务通常按创建顺序编号，
# 较低 ID 更老，通常优先级更高）。
TaskGet(taskId: "<chosen id>")
TaskUpdate(taskId: "<chosen id>", status: "in_progress", owner: "<your handle>")
```

## 注意事项

- 队友启发式：当多个 `pending` 任务未被阻塞且未认领时，选最低 ID。这保持工作 FIFO，避免两个代理同抢一个高关注度任务。
- 尊重 `blockedBy`：不要开始前置仍 `pending` 或 `in_progress` 的任务。先做前置，或与其 owner 协调。
- `TaskList` 是发现任务的唯一机制。没有搜索；列表长时按结构（先按 status，再按 owner）扫描。
- 已删除任务可能仍以 `deleted` 状态出现在列表中以留痕。规划时忽略它们。
- 列表反映团队的实时状态，队友可能在两次调用之间新增或认领任务。时间久了认领前先重新列表。
