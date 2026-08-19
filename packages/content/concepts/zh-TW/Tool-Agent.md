# Agent

啟動一個擁有獨立上下文視窗的自主 Claude Code 子代理，用於處理聚焦的任務並回傳單一合併結果。這是委派開放式研究、平行工作或團隊協作的標準機制。

## 使用時機

- 開放式搜尋——你尚不清楚哪些檔案相關，預期需要多輪 `Glob`、`Grep` 與 `Read`。
- 平行的獨立工作——在同一則訊息中啟動多個代理，同時調查不同領域。
- 將嘈雜的探索與主對話隔離，使父層上下文保持精簡。
- 委派給特定的子代理類型，例如 `Explore`、`Plan`、`claude-code-guide` 或 `statusline-setup`。
- 把一位具名的隊友加入一個運作中的團隊，以便協同進行多代理工作。

當目標檔案或符號已經明確時，不要使用此工具——直接用 `Read`、`Grep` 或 `Glob`。透過 `Agent` 進行單步查詢會浪費一整個上下文視窗並增加延遲。

## 參數

- `description`（string，必填）：描述任務的 3–5 個字短標籤；會顯示在 UI 與記錄中。
- `prompt`（string，必填）：代理將執行的完整、自我包含的任務說明。必須包含所有必要的背景、限制條件與預期回傳格式。
- `subagent_type`（string，選填）：預設角色，例如 `general-purpose`、`Explore`、`Plan`、`claude-code-guide` 或 `statusline-setup`。預設為 `general-purpose`。
- `run_in_background`（boolean，選填）：若為 true，代理會非同步執行，父層可繼續工作；結果稍後取得。
- `model`（string，選填）：為此代理覆寫模型——`opus`、`sonnet` 或 `haiku`。預設為父層工作階段所用的模型。
- `isolation`（string，選填）：設為 `worktree` 可讓代理在獨立的 git worktree 中執行，避免其檔案寫入與父層衝突。
- `team_name`（string，選填）：在加入既有團隊時，該代理要加入的團隊識別碼。
- `name`（string，選填）：團隊內可尋址的隊友名稱，會作為 `SendMessage` 的 `to` 目標。

## 範例

### 範例 1：開放式程式碼搜尋

```
Agent(
  description="Find auth middleware",
  subagent_type="Explore",
  prompt="Locate every place in this repo where JWT verification is performed. Return a bulleted list of absolute file paths with a one-line note about each site's role. Do not modify any files."
)
```

### 範例 2：平行獨立調查

在同一則訊息中啟動兩個代理——一個檢查建構流水線，一個審視測試框架。每個都有自己的上下文視窗，並回傳摘要。將多個代理放在單一 tool-call 區塊中可以同時執行。

### 範例 3：把一位隊友加入運作中的團隊

```
Agent(
  description="Data layer specialist",
  team_name="refactor-crew",
  name="db-lead",
  prompt="You are db-lead on team refactor-crew. Audit all Prisma schema files and propose a migration plan. Use SendMessage to report findings to the team leader."
)
```

## 注意事項

- 代理不會記得先前的執行內容。每次呼叫都從零開始，因此 `prompt` 必須完全自我包含——包含檔案路徑、慣例、問題，以及你想拿回的答案格式。
- 代理只會回傳一則最終訊息。它無法在執行過程中反問釐清，因此 prompt 中的模糊不清會變成結果中的猜測。
- 當子任務彼此獨立時，平行執行多個代理比循序呼叫快得多。請把它們批次放在單一 tool-call 區塊中。
- 若代理將寫入檔案，而你想在合併至主工作樹之前先檢視變更，就用 `isolation: "worktree"`。
- 對於唯讀偵查，優先選擇 `subagent_type: "Explore"`；設計工作則選 `Plan`；混合讀寫任務使用預設的 `general-purpose`。
- 背景代理（`run_in_background: true`）適合長時間的工作；不要用 sleep 迴圈輪詢——完成時父層會收到通知。
