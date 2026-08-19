# WebFetch

获取一个公开网页的内容，将 HTML 转换为 Markdown，再用一个小型辅助模型按自然语言提示从结果中提取你所需的信息。

## 何时使用

- 阅读对话中引用的公开文档页面、博文或 RFC。
- 从已知 URL 中提取特定事实、代码片段或表格，而不必把整页加载进上下文。
- 归纳开放网络资源的发布说明或变更日志。
- 当源码不在本地仓库时，查阅某个库的公开 API 参考。
- 跟进用户粘入聊天的链接，以回答追问。

## 参数

- `url` (string, 必填)：完整的绝对 URL。纯 `http://` 会自动升级到 `https://`。
- `prompt` (string, 必填)：传给提取模型的指令。精确描述要从页面中拉取什么，例如 "list all exported functions" 或 "return the minimum supported Node version"。

## 示例

### 示例 1：提取配置默认值

```
WebFetch(
  url="https://vitejs.dev/config/server-options.html",
  prompt="What is the default value of server.port and can it be a string?"
)
```

工具获取 Vite 文档页，转为 Markdown 并返回简短答复，如「Default is `5173`; accepts a number only.」

### 示例 2：归纳 changelog 的某一节

```
WebFetch(
  url="https://nodejs.org/en/blog/release/v20.11.0",
  prompt="List the security fixes included in this release as bullet points."
)
```

当用户询问「Node 20.11 有什么变化」、而发布页很长时很有用。

## 注意事项

- 任何需要认证、cookie 或 VPN 的 URL 都会使 `WebFetch` 失败。对于 Google Docs、Confluence、Jira、私有 GitHub 资源或内网 wiki，请使用提供认证访问的专用 MCP 服务。
- 对于 GitHub 上的任何内容（PR、issue、文件 blob、API 响应），请优先通过 `Bash` 使用 `gh` CLI，而非爬取 Web UI。`gh pr view`、`gh issue view` 和 `gh api` 返回结构化数据，并可用于私有仓库。
- 当抓取到的页面很大时，结果可能被摘要。如果你需要精确文本，请在 `prompt` 中缩小范围以索取字面摘录。
- 每个 URL 应用一个自清理的 15 分钟缓存。同一会话对同一页面的重复调用接近即时，但可能返回稍陈旧的内容。若对时效敏感，请在提示中说明，或等过缓存。
- 若目标主机发生跨主机重定向，工具会在特殊响应块中返回新 URL，且不会自动跟进。若仍想要内容，请用重定向目标重新调用 `WebFetch`。
- 提示由比主助手更小更快的模型执行。保持窄而具体；复杂的多步推理应在获取后自行阅读原始 Markdown 来完成。
- 切勿把密钥、令牌或会话标识嵌入 URL——页面内容与反映在输出中的查询字符串可能被上游服务记录。
