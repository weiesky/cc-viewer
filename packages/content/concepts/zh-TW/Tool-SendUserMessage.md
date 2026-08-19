# SendUserMessage

向使用者傳送訊息——brief 風格工作階段中主要的可見輸出頻道。亦以其舊別名 `Brief` 為人所知。

## 使用時機

- 回覆使用者剛說的話（`status="normal"`）。
- 主動呈現使用者尚未要求且現在需要看到的內容——他們不在時任務完成、你遇到的阻礙、主動的狀態更新（`status="proactive"`）。

## 啟用方式

- 預設在互動式工作階段中隱藏；大多數互動式 CLI 工作階段會改為直接與使用者對話。
- 在 brief 模式中或透過伺服器端功能旗標啟用。

## 參數

在 brief 模式中：

- `message`（string，必填）：給使用者的訊息。支援 markdown 格式。
- `attachments`（array，選填）：與訊息一同顯示的附件。每個條目可以是本地可讀檔案的檔案路徑（絕對路徑或相對於 cwd），或從裝置工具（如 `attach_file`）取得的預解析 `{file_uuid, file_name, size, is_image}` 物件。
- `status`（string，必填）：使用者現在需要的非請求更新用 `proactive`；回覆使用者時用 `normal`。

在非 brief 建置中僅 `message` 可用。

## 範例

### 範例 1：主動完成通知

```
SendUserMessage(
  message="The migration finished — 42 files updated, tests green.",
  status="proactive"
)
```

## 注意事項

- 謹慎使用 `proactive`——它適用於真正需要使用者立即注意的事。
