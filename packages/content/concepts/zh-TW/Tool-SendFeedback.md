# SendFeedback

向 Anthropic 發送關於 Claude Code 的結構化回饋——錯誤回報、功能構想或缺失的能力——無需離開工作階段。

## 使用時機

- 使用者要求回報錯誤，或對 Claude Code 本身發送回饋。
- 你遇到明確的產品缺陷（指令損壞、行為錯誤、當機），值得回報。
- 使用者描述一個他們希望存在的功能（構想或缺失的能力）。

## 參數

- `type`（string，必填）：`bug`、`idea`、`missing_capability` 其中之一。
- `title`（string，必填）：對問題的簡短、明確一行摘要。
- `details`（string，必填）：帶標籤的條列項目，依序為：**What happened:**（觀察到的 vs. 預期的，若錯誤文字簡短則附上確切內容）；**What the user said:**（引用原文，或「User didn't comment; observed by the model.」）；**Repro:**（最小重現步驟）；**Evidence:**（請求 ID、時間戳記、路徑、版本——無則省略）；最後可選擇性的 **Cause:**——僅限在工作階段內驗證過的內容。每條一到三行；不要敘事段落、不要臆測、不要機密。
- `area`（string，選填）：指明此回饋關於 Claude Code 哪個部分的簡短標籤（例如 "hooks config"、"/help"、"file editing"）。不清楚時留空。
- `failure_mode`（string，選填）：用於模型行為回報，最接近的失效模式（例如 `instruction_following`、`repetition_and_looping`、`context_and_memory`、`stopping_short` 或 `other`）。僅在回報為純產品/工具錯誤時省略。
- `task_category`（string，選填）：問題發生時工作階段正在做什麼：`code_edit`、`debug`、`explain`、`plan`、`shell`、`search`、`review` 或 `other`。

## 範例

### 範例 1：回報產品錯誤

```
SendFeedback(
  type="bug",
  title="/export truncates the last message",
  details="**What happened:** exported transcript is missing the final assistant message.\n**What the user said:** \"the last reply never shows up in the file\".\n**Repro:** run /export after any multi-turn session.\n**Evidence:** v2.1.233, macOS.",
  area="/export",
  task_category="other"
)
```

## 注意事項

- 絕不在 `details` 中包含機密、token 或私人使用者資料。
- 有使用者原話時引用原文；否則說明此問題由模型觀察到。
- 保持回報符合事實——關於根本原因的臆測只在已於工作階段內驗證時才寫入 `**Cause:**`。
