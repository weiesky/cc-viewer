# TodoWrite

為目前工作階段寫入一份結構化待辦清單，取代先前的清單。每個項目包含其文字、狀態，以及顯示在進度指示器中的現在進行式形式。

## 使用時機

- 任務包含數個明確步驟，追蹤進度有助於你（與使用者）掌握進展。
- 使用者明確要求一份待辦清單。
- 你想將恰好一個項目標記為進行中，其餘保持待辦或已完成。

## 啟用方式

- 舊版工具：在提供 Task 工具（`TaskCreate`、`TaskUpdate`、`TaskList`）的工作階段中預設停用。
- 以 `CLAUDE_CODE_ENABLE_TASKS=0` 重新啟用。

## 參數

- `todos`（array，必填）：完整的更新後待辦清單。每個條目包含：
  - `content`（string）：任務描述。
  - `status`（string）：`pending`、`in_progress`、`completed` 其中之一。
  - `activeForm`（string）：項目進行中時顯示的現在進行式文字（例如 "Running tests"）。

## 範例

### 範例 1：追蹤一個三步驟的變更

```
TodoWrite(
  todos=[
    {content="Update the parser", status="in_progress", activeForm="Updating the parser"},
    {content="Add unit tests", status="pending", activeForm="Adding unit tests"},
    {content="Run the full test suite", status="pending", activeForm="Running the full test suite"}
  ]
)
```

每次呼叫都會重寫整份清單——務必包含所有項目，而不只是有變動的項目。

## 注意事項

- 清單在每次呼叫時會被整體取代；要更新一個項目，就重新提交每個項目並附上新的狀態。
- 同一時間只保留恰好一個項目為 `in_progress`。
- 在啟用結構化任務工具（`TaskCreate`/`TaskUpdate`/`TaskList`）的工作階段中，harness 可能提供這些工具來取代 `TodoWrite`——優先使用公告中的那套工具。
