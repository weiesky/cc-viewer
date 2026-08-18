# TaskCreate

在当前团队的任务列表中创建一个新任务（若当前无团队，则在会话任务列表中）。用它记录需要跟踪、委派或以后回顾的工作项。

## 何时使用

- 用户描述的是多步骤工作，通过显式跟踪更有收益。
- 你在把大请求拆成可以分别完成的小单元。
- 在工作中发现了不能被遗忘的后续事项。
- 在把工作移交给队友或子代理前，需要留下对意图的持久记录。
- 你在计划模式下，并希望把每个计划步骤表达为具体任务。

对于简单的一次性动作、纯粹的对话，或两三次直接工具调用即可完成的任务，跳过 `TaskCreate`。

## 启用方式

- 在大多数模型上默认可用。
- 在 Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 及更高版本家族（v2.1.233+）上不可用，除非通过 `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`、`--allowedTools` 或 `--tools` 选择启用。
- 当 `CLAUDE_CODE_ENABLE_TASKS=false` 时，整个任务系统被禁用。

## 参数

- `subject` (string, 必填)：简短的祈使式标题，例如 `Fix login redirect on Safari`。尽量不超过 80 字符。
- `description` (string, 必填)：详细上下文——问题、约束、验收标准以及未来阅读者所需的文件或链接。写得像有队友会冷启动接手。
- `activeForm` (string, 可选)：任务处于 `in_progress` 时展示的现在进行时 spinner 文本，例如 `Fixing login redirect on Safari`。与 `subject` 对应，但使用 -ing 形式。
- `metadata` (object, 可选)：附加到任务的任意结构化数据。常见用途：标签、优先级提示、外部工单 ID 或代理专用配置。

新建任务始终以状态 `pending`、无 owner 的形式开始。依赖（`blocks`、`blockedBy`）不在创建时设置——稍后通过 `TaskUpdate` 添加。

## 示例

### 示例 1

捕获用户刚提交的 bug 报告。

```
TaskCreate(
  subject: "Repair broken PDF export on Windows",
  description: "Users on Windows 11 report the export button produces a 0-byte file. Reproduce with sample doc in test/fixtures/export/, then fix the code path in src/export/pdf.ts. Acceptance: export writes a valid PDF and the existing export test suite passes.",
  activeForm: "Repairing broken PDF export on Windows"
)
```

### 示例 2

在会话开始时把 epic 拆成可跟踪的单元。

```
TaskCreate(
  subject: "Draft migration plan for auth service",
  description: "Produce a written plan covering rollout stages, rollback strategy, and monitoring. Output: docs/auth-migration.md.",
  activeForm: "Drafting migration plan for auth service",
  metadata: { "priority": "P1", "linearId": "AUTH-214" }
)
```

## 注意事项

- `subject` 用祈使语态写，`activeForm` 用现在进行时写，这样当任务切换到 `in_progress` 时 UI 读起来自然。
- 创建前调用 `TaskList` 以避免重复——团队列表与队友和子代理共享。
- 不要在 `description` 或 `metadata` 中包含密钥或凭证；任务记录对拥有团队访问权限的任何人可见。
- 创建后通过 `TaskUpdate` 推进任务生命周期。不要让工作静默停留在 `in_progress`。
