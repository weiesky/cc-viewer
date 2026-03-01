# AskUserQuestion

## 定義

在執行過程中向使用者提問，用於取得澄清、驗證假設或請求決策。

## 參數

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `questions` | array | 是 | 問題列表（1-4 個問題） |
| `answers` | object | 否 | 使用者收集的答案 |
| `annotations` | object | 否 | 每個問題的註解（如預覽選擇的備註） |
| `metadata` | object | 否 | 追蹤和分析用的中繼資料 |

每個 `question` 物件：

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `question` | string | 是 | 完整的問題文字，應以問號結尾 |
| `header` | string | 是 | 短標籤（最多 12 字元），顯示為標籤晶片 |
| `options` | array | 是 | 2-4 個選項 |
| `multiSelect` | boolean | 是 | 是否允許多選 |

每個 `option` 物件：

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `label` | string | 是 | 選項顯示文字（1-5 個詞） |
| `description` | string | 是 | 選項說明 |
| `markdown` | string | 否 | 預覽內容（用於 ASCII 佈局、程式碼片段等的視覺化對比） |

## 使用場景

**適合使用：**
- 收集使用者偏好或需求
- 澄清模糊的指令
- 在實施過程中取得決策
- 向使用者提供方向選擇

**不適合使用：**
- 問「方案可以嗎？」——應使用 ExitPlanMode

## 注意事項

- 使用者始終可以選擇 "Other" 提供自訂輸入
- 推薦選項放在第一位，並在 label 末尾加 "(Recommended)"
- `markdown` 預覽僅支援單選問題
- 有 `markdown` 的選項會切換為左右並排佈局
- 在規劃模式中，用於在確定方案前澄清需求

## 在 cc-viewer 中的意義

AskUserQuestion 呼叫在請求日誌中表現為 `tool_use` content block，包含問題和選項定義。使用者的回答會出現在後續請求的訊息歷史中。

## 原文

<textarea readonly>Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- Users will always be able to select "Other" to provide custom text input
- Use multiSelect: true to allow multiple answers to be selected for a question
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label

Plan mode note: In plan mode, use this tool to clarify requirements or choose between approaches BEFORE finalizing your plan. Do NOT use this tool to ask "Is my plan ready?" or "Should I proceed?" - use ExitPlanMode for plan approval. IMPORTANT: Do not reference "the plan" in your questions (e.g., "Do you have feedback about the plan?", "Does the plan look good?") because the user cannot see the plan in the UI until you call ExitPlanMode. If you need plan approval, use ExitPlanMode instead.

Preview feature:
Use the optional `markdown` field on options when presenting concrete artifacts that users need to visually compare:
- ASCII mockups of UI layouts or components
- Code snippets showing different implementations
- Diagram variations
- Configuration examples

When any option has a markdown, the UI switches to a side-by-side layout with a vertical option list on the left and preview on the right. Do not use previews for simple preference questions where labels and descriptions suffice. Note: previews are only supported for single-select questions (not multiSelect).
</textarea>
