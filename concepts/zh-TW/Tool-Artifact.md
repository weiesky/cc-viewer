# Artifact

將 HTML 或 Markdown 檔案渲染為 Artifact——一個預設隱私、託管在 claude.ai 上的網頁，使用者可在瀏覽器中開啟並隨後選擇分享。當視覺傳達優於終端文字時，使用此工具。

## 使用時機

- 發佈視覺可交付物：報告、儀表板、bug 調查文件或 UI 原型
- 原地更新先前發佈的頁面（相同檔案路徑會重新部署到相同 URL）
- 列出使用者現有 artifacts 以查找來自早期工作階段的檔案（`action: "list"`）
- **不適用於**必須保持本地的內容、純文字答案或需要在檢視時存取外部網路資源的任何東西——嚴格的 CSP 阻止所有外部主機

## 啟用方式

- 需要 Pro、Max、Team 或 Enterprise 方案並登入 claude.ai（`/login`）。
- 僅限 Anthropic API——在 Amazon Bedrock、Google Cloud 或 Microsoft Foundry 上不可用。
- 需要 Claude Code ≥ 2.1.183 或 Desktop 應用程式 ≥ 1.13576.0。
- 以 `disableArtifact` 設定或 `CLAUDE_CODE_DISABLE_ARTIFACT=1` 停用。

## 參數

- `file_path`（字串）：要渲染的 `.html` 或 `.md` 檔案路徑。檔案在發佈時被包裝在文件框架中，因此直接寫入頁面內容——不要包括 `<!DOCTYPE>`、`<html>`、`<head>` 或 `<body>` 標籤。相同路徑 → 重新部署時使用相同 URL；不同路徑則申請新 URL。
- `favicon`（字串，發佈時必填）：用作瀏覽器標籤頁圖示的一個或兩個 emoji（例如 `"📊"`）。僅 emoji，無標記。在重新部署時保持相同——使用者透過其圖示查找標籤頁。
- `description`（字串）：artifact 庫卡片上顯示的單句副標題。
- `url`（字串，可選）：傳遞現有 artifact 的 URL 以從未發佈該檔案的對話中原地更新。不帶此參數時，新對話始終會分配新 URL。
- `label`（字串，可選）：版本選擇器中顯示的簡短易讀版本名稱（最多 60 個字元）。
- `action`（字串，可選）：`"publish"`（預設）或 `"list"`——列舉使用者的已發佈 artifacts（標題、URL、最後更新時間），可選擇 `limit`。
- `force`（布林值，可選）：無需衝突檢查即覆寫。僅在來自並行寫入的 409 之後使用，且已協調。

## 注意事項

- **僅限獨立。** 嚴格的 CSP 阻止對任何外部主機的要求——CDN 指令碼、外部樣式表、遠端圖片、fetch/WebSocket。將所有 CSS/JS 內連，並將資產嵌入為 `data:` URI。
- **回應式且主題感知。** 頁面在檢視器的淺色或深色主題中呈現；為兩者都設定樣式（`prefers-color-scheme` 加上檢視器的 `data-theme` 覆寫）。寬內容在其自身容器內捲動——頁面正文絕不能水平捲動。
- **跨對話更新需要 `url`。** 在發佈該 artifact 的對話內重新部署相同檔案路徑僅重用 URL；要保留較舊 artifact 的連結，使用 `action: "list"` 查找其 URL，並將其作為 `url` 傳遞。
- **發佈面向外部。** 發送到 artifact 服務的內容即使後來刪除，也可能被快取——不要發佈任何必須保持隱私的內容。
- **使用 WebFetch 讀回。** claude.ai artifact URL 可透過 WebFetch 擷取（不是 curl，curl 擷取應用外殼）。
