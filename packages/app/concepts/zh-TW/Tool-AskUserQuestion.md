# AskUserQuestion

在聊天 UI 中向使用者呈現一個或多個結構化的選擇題，收集其選擇後回傳給助理——適合用來釐清意圖，而不必透過自由形式的來回對話。

## 使用時機

- 請求有多種合理解釋，助理需要使用者先做出選擇才能繼續。
- 使用者必須在具體的選項（框架、函式庫、檔案路徑、策略）中做選擇，而自由文字的回覆容易出錯。
- 你想利用預覽面板並排比較多個替代方案。
- 幾個相關的決策可以合併為單一問卷，以減少來回互動。
- 計畫或工具呼叫依賴使用者尚未指定的設定。

## 參數

- `questions`（array，必填）：一次顯示一到四個問題。每個問題物件包含：
  - `question`（string，必填）：完整的問題文字，以問號結尾。
  - `header`（string，必填）：顯示於問題上方的短標籤（最多 12 個字元）。
  - `options`（array，必填）：二到四個選項物件。每個選項有 `label`（1–5 個字）、`description` 與選填的 `markdown` 預覽。
  - `multiSelect`（boolean，必填）：為 `true` 時允許使用者選擇多個選項。

## 範例

### 範例 1：選擇單一框架

```
AskUserQuestion(questions=[{
  "header": "Test runner",
  "question": "Which test runner should I configure?",
  "multiSelect": false,
  "options": [
    {"label": "Vitest (Recommended)", "description": "Fast, Vite-native, Jest-compatible API"},
    {"label": "Jest",                  "description": "Mature, broadest plugin ecosystem"},
    {"label": "Node --test",           "description": "Zero dependencies, built in"}
  ]
}])
```

### 範例 2：並排預覽兩種版面

```
AskUserQuestion(questions=[{
  "header": "Layout",
  "question": "Which dashboard layout do you prefer?",
  "multiSelect": false,
  "options": [
    {"label": "Sidebar",  "description": "Nav on the left", "markdown": "```\n+------+---------+\n| NAV  | CONTENT |\n+------+---------+\n```"},
    {"label": "Top bar",  "description": "Nav across top",  "markdown": "```\n+-----------------+\n|       NAV       |\n+-----------------+\n|     CONTENT     |\n+-----------------+\n```"}
  ]
}])
```

## 注意事項

- UI 會自動在每個問題後面附加一個「Other」自由文字選項。請不要自行加入「Other」、「None」或「Custom」——會重複內建的退出機制。
- 每次呼叫限制 1–4 個問題，每個問題限制 2–4 個選項。超出範圍會被 harness 拒絕。
- 若你推薦某個特定選項，把它排第一個並在 label 後附加「(Recommended)」，UI 會凸顯該偏好路徑。
- `markdown` 欄位的預覽僅在單選問題中支援。用於視覺化成果（ASCII 版面、程式片段、設定 diff），而不是只需 label 加說明即可的偏好問題。
- 當某題中有任一選項帶有 `markdown` 值時，UI 會切換為並排版面——左側為選項列表，右側為預覽。
- 不要用 `AskUserQuestion` 詢問「這個計畫可以嗎？」——請改呼叫 `ExitPlanMode`，那是為計畫批准所設計的工具。在計畫模式下，也避免在問題文字中提到「the plan」，因為在 `ExitPlanMode` 執行之前使用者看不到計畫。
- 不要使用此工具索取敏感或自由形式的輸入，例如 API 金鑰或密碼。請改在聊天中詢問。
