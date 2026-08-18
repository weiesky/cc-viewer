# Artifact

将 HTML 或 Markdown 文件渲染为 Artifact——一个默认隐私、托管在 claude.ai 上的网页，用户可在浏览器中打开并随后选择分享。当视觉传达优于终端文本时，使用此工具。

## 何时使用

- 发布视觉可交付物：报告、仪表板、bug 调查文档或 UI 原型
- 原地更新先前发布的页面（相同文件路径会重新部署到相同 URL）
- 列出用户现有 artifacts 以查找来自早期会话的文件（`action: "list"`）
- **不适用于**必须保持本地的内容、纯文本答案或需要在查看时访问外部网络资源的任何东西——严格的 CSP 阻止所有外部主机

## 启用方式

- 需要 Pro、Max、Team 或 Enterprise 套餐并登录 claude.ai（`/login`）。
- 仅限 Anthropic API——在 Amazon Bedrock、Google Cloud 或 Microsoft Foundry 上不可用。
- 需要 Claude Code ≥ 2.1.183 或 Desktop 应用 ≥ 1.13576.0。
- 通过 `disableArtifact` 设置或 `CLAUDE_CODE_DISABLE_ARTIFACT=1` 禁用。

## 参数

- `file_path`（字符串）：要渲染的 `.html` 或 `.md` 文件路径。文件在发布时被包装在文档框架中，因此直接写入页面内容——不要包括 `<!DOCTYPE>`、`<html>`、`<head>` 或 `<body>` 标签。相同路径 → 重新部署时使用相同 URL；不同路径则申请新 URL。
- `favicon`（字符串，发布时必填）：用作浏览器标签页图标的一个或两个 emoji（例如 `"📊"`）。仅 emoji，无标记。在重新部署时保持相同——用户通过其图标查找标签页。
- `description`（字符串）：artifact 库卡片上显示的单句副标题。
- `url`（字符串，可选）：传递现有 artifact 的 URL 以从未发布该文件的对话中原地更新。不带此参数时，新对话始终会分配新 URL。
- `label`（字符串，可选）：版本选择器中显示的简短易读版本名称（最多 60 个字符）。
- `action`（字符串，可选）：`"publish"`（默认）或 `"list"`——列举用户的已发布 artifacts（标题、URL、最后更新时间），可选择 `limit`。
- `force`（布尔值，可选）：无需冲突检查即覆盖。仅在来自并发写入的 409 之后使用，且已协调。

## 注意事项

- **仅限独立。** 严格的 CSP 阻止对任何外部主机的请求——CDN 脚本、外部样式表、远程图片、fetch/WebSocket。将所有 CSS/JS 内联，并将资产嵌入为 `data:` URI。
- **响应式且主题感知。** 页面在查看器的浅色或深色主题中呈现；为两者都设置样式（`prefers-color-scheme` 加上查看器的 `data-theme` 覆盖）。宽内容在其自身容器内滚动——页面正文绝不能水平滚动。
- **跨对话更新需要 `url`。** 在发布该 artifact 的对话内重新部署相同文件路径仅重用 URL；要保留较旧 artifact 的链接，使用 `action: "list"` 查找其 URL，并将其作为 `url` 传递。
- **发布面向外部。** 发送到 artifact 服务的内容即使后来删除，也可能被缓存——不要发布任何必须保持隐私的内容。
- **使用 WebFetch 读回。** claude.ai artifact URL 可通过 WebFetch 获取（不是 curl，curl 获取应用外壳）。
