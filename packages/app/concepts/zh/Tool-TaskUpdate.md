# TaskUpdate

修改已有任务——其状态、内容、归属、metadata 或依赖边。这是任务推进生命周期的方式，也是工作在 Claude Code、队友和子代理间移交的方式。

## 何时使用

- 在你开展工作时，让任务沿状态流推进。
- 通过把自己（或另一代理）设为 `owner` 来认领任务。
- 在你对问题有更多了解后，精化 `subject` 或 `description`。
- 用 `addBlocks` / `addBlockedBy` 记录新发现的依赖。
- 附加结构化 `metadata`，如外部工单 ID 或优先级提示。

## 启用方式

- 在大多数模型上默认可用。
- 在 Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 及更高版本家族（v2.1.233+）上不可用，除非通过 `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`、`--allowedTools` 或 `--tools` 选择启用。
- 当 `CLAUDE_CODE_ENABLE_TASKS=false` 时，整个任务系统被禁用。

## 参数

- `taskId` (string, 必填)：要修改的任务。从 `TaskList` 或 `TaskCreate` 获取。
- `status` (string, 可选)：`pending`、`in_progress`、`completed`、`deleted` 之一。
- `subject` (string, 可选)：替换的祈使式标题。
- `description` (string, 可选)：替换的详细描述。
- `activeForm` (string, 可选)：替换的现在进行时 spinner 文本。
- `owner` (string, 可选)：接手该任务的代理或队友 handle。
- `metadata` (object, 可选)：要合并到任务的 metadata 键值。将某键设为 `null` 可删除它。
- `addBlocks` (array of strings, 可选)：本任务阻塞的任务 ID 列表。
- `addBlockedBy` (array of strings, 可选)：必须在本任务之前完成的任务 ID 列表。

## 状态流

生命周期刻意线性：`pending` → `in_progress` → `completed`。`deleted` 是终态，用于撤销永远不会开展的任务。

- 在你真正开始工作的那一刻才设为 `in_progress`，不要提前。对同一 owner 而言，同一时间应仅有一个任务处于 `in_progress`。
- 只有当工作完全完成——验收标准达成、测试通过、输出写出——才设为 `completed`。若出现阻塞，保持任务 `in_progress` 并新增一个任务描述需要解决的事项。
- 测试失败、实现部分完成或遇到未解决的错误时，绝不要把任务标为 `completed`。
- 对被取消或重复的任务使用 `deleted`；不要把任务挪作他用。

## 示例

### 示例 1

认领任务并开始。

```
TaskUpdate(
  taskId: "t_01HXYZ...",
  status: "in_progress",
  owner: "main-agent"
)
```

### 示例 2

完成工作并记录后续依赖。

```
TaskUpdate(
  taskId: "t_01HXYZ...",
  status: "completed"
)

TaskUpdate(
  taskId: "t_01FOLLOWUP...",
  addBlockedBy: ["t_01HXYZ..."]
)
```

## 注意事项

- `metadata` 按键合并；为某键传 `null` 会删除它。若不确定当前内容，先调用 `TaskGet`。
- `addBlocks` 与 `addBlockedBy` 追加边；它们不会移除既有边。破坏性地编辑依赖图需要专用流程——重写依赖前咨询团队负责人。
- 修改 `subject` 时请同步更新 `activeForm`，以便 spinner 文本读起来自然。
- 不要为了静默一个任务而把它标为 `completed`。若用户取消工作，使用 `deleted` 并在 `description` 中简要说明原因。
- 更新前用 `TaskGet` 读取最新状态——队友可能在你上次读取和此次写入之间改动了它。
