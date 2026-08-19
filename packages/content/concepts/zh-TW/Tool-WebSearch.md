# WebSearch

執行即時網路搜尋，並回傳排序後的結果，助理可用這些結果基於當前資訊作答，超越模型的訓練截止日。

## 使用時機

- 回答關於時事、近期發布或突發新聞的問題。
- 查詢函式庫、框架或 CLI 工具的最新版本。
- 在不知道確切 URL 時尋找說明文件或部落格文章。
- 驗證自模型訓練後可能已改變的事實。
- 在用 `WebFetch` 擷取單一頁面之前，對主題探索多種觀點。

## 啟用方式

- 可用性依供應商與模型而定：在 Anthropic API 與 Claude Platform on AWS 上可用；在 Microsoft Foundry 上需要 Anthropic 託管的部署；在 Google Cloud 上適用於 Claude 4+ 模型。
- 在 Amazon Bedrock 上不可用。
- 以 `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION` 將每個工作階段的上限設為 200 次呼叫。

## 參數

- `query`（string，必填）：搜尋查詢。最短 2 個字元。在詢問「最新」或「近期」資訊時請加上當前年份，以確保結果新鮮。
- `allowed_domains`（string 陣列，選填）：只允許來自這些網域的結果，例如 `["nodejs.org", "developer.mozilla.org"]`。在你信任特定來源時有用。
- `blocked_domains`（string 陣列，選填）：排除來自這些網域的結果。同一網域不要同時傳入 `allowed_domains` 與 `blocked_domains`。

## 範例

### 範例 1：用當前年份查版本

```
WebSearch(
  query="React 19 stable release date 2026",
  allowed_domains=["react.dev", "github.com"]
)
```

回傳官方公告，避開品質較差的內容聚合網站。

### 範例 2：排除吵雜的來源

```
WebSearch(
  query="kubernetes ingress-nginx CVE April 2026",
  blocked_domains=["pinterest.com", "medium.com"]
)
```

讓結果聚焦於廠商公告與安全追蹤器。

## 注意事項

- 在回答中使用 `WebSearch` 時，必須在回應最後附加一個 `Sources:` 段落，以 Markdown 超連結 `[Title](URL)` 列出每個引用的結果。這是硬性要求，不可省略。
- `WebSearch` 僅對美國使用者可用。若該工具在你的地區不可用，可退回使用 `WebFetch` 對已知 URL 擷取，或請使用者貼上相關內容。
- 每次呼叫在一次往返中完成搜尋——無法串流或分頁。若首批結果偏離目標，請精煉查詢。
- 工具回傳片段與 metadata，非完整頁面內容。若要深入閱讀某一筆結果，接著用 `WebFetch` 搭配回傳的 URL。
- 對安全敏感的問題（如 CVE 或合規），使用 `allowed_domains` 強制從權威來源取得；使用 `blocked_domains` 濾掉鏡像文件的 SEO 農場。
- 保持查詢簡短且以關鍵字為主。自然語言問句可行，但往往回傳對話式回答而非第一手來源。
- 不要根據搜尋直覺臆造 URL——一律執行搜尋並引用工具實際傳回的內容。
