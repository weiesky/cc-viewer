# WebFetch

## 定義

擷取指定 URL 的網頁內容，將 HTML 轉換為 markdown，並使用 AI 模型根據 prompt 處理內容。

## 參數

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `url` | string (URI) | 是 | 要擷取的完整 URL |
| `prompt` | string | 是 | 描述要從頁面中提取什麼資訊 |

## 使用場景

**適合使用：**
- 取得公開網頁的內容
- 查閱線上文件
- 提取網頁中的特定資訊

**不適合使用：**
- 需要認證的 URL（Google Docs、Confluence、Jira、GitHub 等）——應先查找專用的 MCP 工具
- GitHub URL——優先使用 `gh` CLI

## 注意事項

- URL 必須是完整的有效 URL
- HTTP 會自動升級為 HTTPS
- 內容過大時結果可能被摘要
- 包含 15 分鐘自清理快取
- 當 URL 重新導向到不同主機時，工具會回傳重新導向 URL，需要用新 URL 重新請求
- 如果有 MCP 提供的 web fetch 工具可用，優先使用那個

## 在 cc-viewer 中的意義

WebFetch 呼叫在請求日誌中表現為 `tool_use` / `tool_result` content block 對。`tool_result` 包含經 AI 處理後的網頁內容摘要。

## 原文

<textarea readonly>IMPORTANT: WebFetch WILL FAIL for authenticated or private URLs. Before using this tool, check if the URL points to an authenticated service (e.g. Google Docs, Confluence, Jira, GitHub). If so, you MUST use ToolSearch first to find a specialized tool that provides authenticated access.

- Fetches content from a specified URL and processes it using an AI model
- Takes a URL and a prompt as input
- Fetches the URL content, converts HTML to markdown
- Processes the content with the prompt using a small, fast model
- Returns the model's response about the content
- Use this tool when you need to retrieve and analyze web content

Usage notes:
  - IMPORTANT: If an MCP-provided web fetch tool is available, prefer using that tool instead of this one, as it may have fewer restrictions.
  - The URL must be a fully-formed valid URL
  - HTTP URLs will be automatically upgraded to HTTPS
  - The prompt should describe what information you want to extract from the page
  - This tool is read-only and does not modify any files
  - Results may be summarized if the content is very large
  - Includes a self-cleaning 15-minute cache for faster responses when repeatedly accessing the same URL
  - When a URL redirects to a different host, the tool will inform you and provide the redirect URL in a special format. You should then make a new WebFetch request with the redirect URL to fetch the content.
  - For GitHub URLs, prefer using the gh CLI via Bash instead (e.g., gh pr view, gh issue view, gh api).
</textarea>
