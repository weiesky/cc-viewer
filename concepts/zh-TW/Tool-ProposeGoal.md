# ProposeGoal

為工作階段提出一個可驗證的完成目標。此目標（預設）會顯示在使用者的核准對話框中，一旦設定，會引導對話其餘部分朝向可檢查的結果。

## 使用時機

- 工作階段有具體的結束狀態，評估者可以從對話中驗證（例如「test/auth 中的所有測試通過」）。
- 你希望使用者在進行大量工作之前，明確簽署「完成」的定義。
- 使用者自己的話已陳述了結果，而你想將它記錄為工作階段目標。

## 參數

- `condition`（string，必填）：完成條件，撰寫方式要讓獨立的評估者能從對話中驗證（例如「test/auth 中的所有測試通過（bun test 以 0 結束）」）。最多 500 個字元——使用者必須能在核准對話框中讀到完整條件。
- `ask_user`（boolean，選填）：是否在目標設定前詢問使用者核准。預設為 true（顯示核准對話框）。僅當使用者在本次對話中以自己的話陳述了此結果為他們想要的時，才設為 false；此時目標會直接設定並顯示可見通知，使用者可用 `/goal clear` 清除。

## 範例

### 範例 1：提出以測試為依據的目標

```
ProposeGoal(condition="npm run test exits 0 with the new catalog cases included")
```

使用者會在核准對話框中看到條件，可以接受、編輯或拒絕。

### 範例 2：直接採用使用者陳述的結果

```
ProposeGoal(condition="the login form validates email format and shows an inline error", ask_user=false)
```

僅因使用者稍早在對話中明確陳述了該結果才有效。

## 注意事項

- 保持 `condition` 簡短且可客觀檢查——模糊的目標（「讓它更好」）會失去意義。
- `ask_user=false` 嚴格限於使用者自己陳述的結果；其他一切都必須經過核准對話框。
