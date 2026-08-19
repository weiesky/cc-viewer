# Skill

在當前對話中呼叫具名的 skill。Skill 是預先封裝的能力組合——領域知識、工作流程，以及有時也包含工具存取——由 harness 透過系統提示（system reminder）揭露給助理。

## 使用時機

- 使用者輸入 slash command，例如 `/review` 或 `/init`——slash command 是 skill，必須透過此工具執行。
- 使用者描述的任務符合某個已公告 skill 的觸發條件（例如要求掃描逐字稿以找出重複出現的權限提示，就符合 `fewer-permission-prompts`）。
- 某個 skill 的目的說明與目前的檔案、請求或對話背景直接吻合。
- 有專門且可重複的工作流程以 skill 形式提供，且這份正式程序比臨時做法更好。
- 使用者問「有哪些 skill 可用」——列出公告的名稱，並在他們確認時才呼叫。

## 參數

- `skill`（string，必填）：目前 available-skills 系統提示中所列的確切 skill 名稱。若為外掛命名空間下的 skill，請使用完整 `plugin:skill` 形式（例如 `skill-creator:skill-creator`）。不要帶前置斜線。
- `args`（string，選填）：傳給 skill 的自由形式參數。格式與語意由每個 skill 自己的說明定義。

## 範例

### 範例 1：對目前分支執行 review skill

```
Skill(skill="review")
```

`review` skill 封裝了對當前基底分支進行 pull request 審閱的步驟。呼叫它會把 harness 定義的審閱流程載入本輪。

### 範例 2：以參數呼叫外掛命名空間下的 skill

```
Skill(
  skill="skill-creator:skill-creator",
  args="create a skill that summarizes git log for a given date range"
)
```

將請求導向 `skill-creator` 外掛的進入點，啟動撰寫 skill 的工作流程。

## 注意事項

- 只能呼叫名稱完全列在 available-skills 系統提示中的 skill，或使用者在訊息中直接以 `/name` 輸入的 skill。絕對不要從記憶或訓練資料中猜測或臆造 skill 名稱——若該 skill 未被公告，就不要呼叫此工具。
- 當使用者的請求符合已公告的 skill，呼叫 `Skill` 是阻斷性前置動作：在就任務產生任何其他回應之前先呼叫它。不要描述 skill 會做什麼——直接執行它。
- 不要在未實際呼叫 skill 的情況下提起 skill 的名稱。宣告 skill 卻不呼叫工具會誤導使用者。
- 不要使用 `Skill` 來執行內建 CLI 指令，例如 `/help`、`/clear`、`/model` 或 `/exit`。這些由 harness 直接處理。
- 不要重新呼叫本輪已在執行中的 skill。若你在目前這輪看到 `<command-name>` 標籤，代表該 skill 已載入——請就地依其指示進行，而不是再次呼叫工具。
- 若多個 skill 都適用，請挑最具體的那一個。對於新增權限或 hook 等設定變更，優先選擇 `update-config` 而非一般的設定路徑。
- Skill 執行可能為本輪餘下時間引入新的系統提示、工具或限制。skill 完成後，請重新閱讀對話狀態再繼續。
