# WebFetch

擷取公開網頁內容，將 HTML 轉為 Markdown，並以自然語言 prompt 讓一個小型輔助模型在結果上萃取出你需要的資訊。

## 使用時機

- 閱讀對話中提到的公開說明頁面、部落格文章或 RFC。
- 從已知 URL 擷取特定事實、程式片段或表格，而不把整頁載入上下文。
- 從開放網頁資源摘要發行說明或 changelog。
- 在原始碼不在本地 repo 時，查閱函式庫的公開 API 參考。
- 跟進使用者貼進聊天中的連結以回答後續問題。

## 參數

- `url`（string，必填）：完整成形的絕對 URL。純 `http://` 會自動升級為 `https://`。
- `prompt`（string，必填）：傳給擷取小模型的指示。明確描述要從頁面中拉出什麼，例如「列出所有 exported functions」或「回傳最低支援的 Node 版本」。

## 範例

### 範例 1：擷取設定預設值

```
WebFetch(
  url="https://vitejs.dev/config/server-options.html",
  prompt="What is the default value of server.port and can it be a string?"
)
```

工具會擷取 Vite 的說明頁面、轉為 Markdown，並傳回短答案，例如「Default is `5173`; accepts a number only.」。

### 範例 2：摘要 changelog 章節

```
WebFetch(
  url="https://nodejs.org/en/blog/release/v20.11.0",
  prompt="List the security fixes included in this release as bullet points."
)
```

當使用者問「Node 20.11 改了什麼」、而發行頁面很長時很有用。

## 注意事項

- `WebFetch` 對任何需要認證、cookie 或 VPN 的 URL 會失敗。對 Google Docs、Confluence、Jira、私有 GitHub 資源或內部 wiki，請改用提供認證存取的專屬 MCP 伺服器。
- 對任何託管於 GitHub 的內容（PR、issues、檔案 blob、API 回應），偏好透過 `Bash` 使用 `gh` CLI，而不是爬取 web UI。`gh pr view`、`gh issue view` 與 `gh api` 會回傳結構化資料，且適用於私有 repo。
- 頁面很大時結果可能會被摘要。若需要確切文字，請縮窄 `prompt` 來要求逐字擷取。
- 會套用自動清理的 15 分鐘快取（以 URL 為單位）。同一工作階段內對同頁的重複呼叫幾乎是即時，但可能傳回些微過期的內容。若新鮮度重要，請在 prompt 中提及或等待快取失效。
- 若目標主機發出跨主機重新導向，工具會在特殊回應區塊中傳回新 URL，且不會自動跟進。若仍想要內容，請以重新導向目標重新呼叫 `WebFetch`。
- prompt 由較小、較快的模型執行，不是主助理。請保持窄而具體；複雜的多步推理最好由你自行在擷取後閱讀原始 Markdown 來處理。
- 絕不要傳入嵌入 URL 中的機密、權杖或工作階段識別碼——頁面內容與反映於輸出的查詢字串可能被上游服務記錄。
