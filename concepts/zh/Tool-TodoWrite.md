# TodoWrite

为当前会话写入结构化 todo 列表，替换之前的列表。每个条目包含文本、状态，以及进度指示器中显示的进行时形式。

## 何时使用

- 任务包含若干独立步骤，跟踪它们有助于你（和用户）看到进度。
- 用户明确要求一份 todo 列表。
- 你想把恰好一个条目标记为进行中，其余保持待处理或已完成。

## 参数

- `todos` (array, 必填)：完整更新后的 todo 列表。每个条目包含：
  - `content` (string)：任务描述。
  - `status` (string)：`pending`、`in_progress`、`completed` 之一。
  - `activeForm` (string)：条目进行中时显示的进行时文本（例如 "Running tests"）。

## 示例

### 示例 1：跟踪一个三步改动

```
TodoWrite(
  todos=[
    {content="Update the parser", status="in_progress", activeForm="Updating the parser"},
    {content="Add unit tests", status="pending", activeForm="Adding unit tests"},
    {content="Run the full test suite", status="pending", activeForm="Running the full test suite"}
  ]
)
```

每次调用都会重写整个列表——始终包含全部条目，而不只是发生变化的那些。

## 注意事项

- 每次调用都会整体替换列表；要更新某个条目，请连同新状态重新提交所有条目。
- 同一时间只保持一个 `in_progress` 条目。
- 在启用了结构化任务工具（`TaskCreate`/`TaskUpdate`/`TaskList`）的会话中，运行时可能提供这些工具而非 `TodoWrite`——优先使用被公示的那套工具。
