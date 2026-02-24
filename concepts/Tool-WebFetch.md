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
