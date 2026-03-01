# WebFetch

## 定义

抓取指定 URL 的网页内容，将 HTML 转换为 markdown，并使用 AI 模型根据 prompt 处理内容。

## 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `url` | string (URI) | 是 | 要抓取的完整 URL |
| `prompt` | string | 是 | 描述要从页面中提取什么信息 |

## 使用场景

**适合使用：**
- 获取公开网页的内容
- 查阅在线文档
- 提取网页中的特定信息

**不适合使用：**
- 需要认证的 URL（Google Docs、Confluence、Jira、GitHub 等）——应先查找专用的 MCP 工具
- GitHub URL——优先使用 `gh` CLI

## 注意事项

- URL 必须是完整的有效 URL
- HTTP 会自动升级为 HTTPS
- 内容过大时结果可能被摘要
- 包含 15 分钟自清理缓存
- 当 URL 重定向到不同主机时，工具会返回重定向 URL，需要用新 URL 重新请求
- 如果有 MCP 提供的 web fetch 工具可用，优先使用那个

## 在 cc-viewer 中的意义

WebFetch 调用在请求日志中表现为 `tool_use` / `tool_result` content block 对。`tool_result` 包含经 AI 处理后的网页内容摘要。

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
