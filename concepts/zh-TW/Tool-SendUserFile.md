# SendUserFile

將一個或多個檔案傳送給使用者——產生的產物、截圖、報告——並能控制用戶端呈現它們的方式。

## 使用時機

- 你產生了使用者需要的檔案（報告、圖片、HTML 頁面），想把它呈現出來，而不只是提及路徑。
- 以附件回覆（`status="normal"`），或主動呈現使用者尚未要求但現在需要看到的內容（`status="proactive"`）。

## 參數

- `files`（string 陣列，必填）：要傳送給使用者的檔案路徑（絕對路徑或相對於 cwd）。即使是單一檔案也務必傳入陣列。
- `caption`（string，選填）：檔案的簡短說明文字。
- `status`（string，必填）：呈現使用者尚未要求且現在需要看到的檔案時用 `proactive`——例如產生的產物、完成的報告；回覆使用者剛說的話時用 `normal`。
- `display`（string，選填）：`render` 會在側邊面板內聯開啟檔案（HTML、SVG、Mermaid、圖片、PDF）；`attach` 只顯示下載卡片（使用者會儲存並在其他地方開啟的交付物）。省略則由用戶端依檔案類型決定。

## 範例

### 範例 1：交付一份產生的報告

```
SendUserFile(
  files=["./out/weekly-report.html"],
  caption="Weekly usage report",
  status="proactive",
  display="render"
)
```

## 注意事項

- 需要工作階段允許傳送檔案（受設定/功能門控的能力）；brief 模式中不提供。
- 使用者會儲存並在其他應用程式中開啟的檔案，選擇 `display="attach"`；任何應立即查看的內容用 `render`。
