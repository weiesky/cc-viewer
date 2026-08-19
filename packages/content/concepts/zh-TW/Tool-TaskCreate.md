# TaskCreate

在目前團隊的任務清單（或無團隊時為工作階段的任務清單）中建立新任務。用它來擷取應被追蹤、委派或稍後再回顧的工作項目。

## 使用時機

- 使用者描述了一項多步驟工作，適合以明確追蹤的方式進行。
- 你要把大型請求拆成較小、可獨立完成的單元。
- 任務進行中發現追加事項，不應被遺忘。
- 在把工作交給隊友或子代理之前，需要一份持久的意圖紀錄。
- 你在計畫模式下運作，並希望每個計畫步驟都以具體任務來表示。

對瑣碎的單次動作、純對話或兩三次直接工具呼叫即可完成的事情，略過 `TaskCreate`。

## 啟用方式

- 在大多數模型上預設可用。
- 在 Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 及之後的系列（v2.1.233+）上不可用，除非透過 `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`、`--allowedTools` 或 `--tools` 選擇啟用。
- 當 `CLAUDE_CODE_ENABLE_TASKS=false` 時，整個任務系統會被停用。

## 參數

- `subject`（string，必填）：簡短的祈使句標題，例如 `Fix login redirect on Safari`。盡量控制在 80 個字元以內。
- `description`（string，必填）：詳細背景——問題、限制、驗收條件，以及未來讀者所需的任何檔案或連結。撰寫時要假設會有隊友在沒有背景的情況下接手。
- `activeForm`（string，選填）：任務處於 `in_progress` 時顯示的現在進行式 spinner 文字，例如 `Fixing login redirect on Safari`。形式上呼應 `subject`，但用 -ing 的形式。
- `metadata`（object，選填）：附加在任務上的任意結構化資料。常見用途：標籤、優先度提示、外部工單 ID，或代理專屬的設定。

新建任務一律以狀態 `pending` 開始，且無 owner。相依關係（`blocks`、`blockedBy`）不會在建立時設定——之後以 `TaskUpdate` 套用。

## 範例

### 範例 1

擷取使用者剛回報的 bug。

```
TaskCreate(
  subject: "Repair broken PDF export on Windows",
  description: "Users on Windows 11 report the export button produces a 0-byte file. Reproduce with sample doc in test/fixtures/export/, then fix the code path in src/export/pdf.ts. Acceptance: export writes a valid PDF and the existing export test suite passes.",
  activeForm: "Repairing broken PDF export on Windows"
)
```

### 範例 2

在工作階段開始時把一個 epic 拆成可追蹤單元。

```
TaskCreate(
  subject: "Draft migration plan for auth service",
  description: "Produce a written plan covering rollout stages, rollback strategy, and monitoring. Output: docs/auth-migration.md.",
  activeForm: "Drafting migration plan for auth service",
  metadata: { "priority": "P1", "linearId": "AUTH-214" }
)
```

## 注意事項

- `subject` 使用祈使語氣，`activeForm` 使用現在進行式，這樣當任務轉入 `in_progress` 時，UI 的讀起來會自然。
- 建立前先呼叫 `TaskList` 以避免重複——團隊清單是與隊友與子代理共享的。
- 不要把機密或憑證放入 `description` 或 `metadata`；任務紀錄對所有能存取團隊的人可見。
- 建立後透過 `TaskUpdate` 推進任務生命週期。不要讓工作無聲地停在 `in_progress`。
