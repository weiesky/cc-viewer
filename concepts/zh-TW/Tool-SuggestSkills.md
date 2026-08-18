# SuggestSkills

依據主題關鍵字，渲染一張使用者可新增之獨立 skills 的卡片（尚未啟用的 skills）。

## 使用時機

- 使用者的請求符合他們尚未啟用的 skills（他們主動要求時用 `trigger="user_asked"`，你主動建議時用 `trigger="proactive"`）。

## 參數

- `keywords`（string 陣列，必填）：來自使用者請求的主題關鍵字。1–8 個項目，每個 1–64 個字元。
- `contextLabel`（string，選填）：將建議連結至請求的簡短標籤（最多 128 個字元）。
- `trigger`（string，選填）：此建議如何開始——`user_asked` 或 `proactive`。

## 範例

### 範例 1：依主題建議 skills

```
SuggestSkills(keywords=["data visualization", "charts"], contextLabel="For building the dashboard", trigger="user_asked")
```

已啟用的 skills 會從結果中過濾掉。

## 注意事項

- 僅渲染建議卡片——新增 skill 是在頻帶外進行；之後呼叫 `ListSkills` 以確認。
- 在 HIPAA 企業設定下停用。
