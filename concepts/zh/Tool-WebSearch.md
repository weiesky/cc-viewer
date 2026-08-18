# WebSearch

执行一次实时网络搜索并返回排名结果，助手用它来把答案锚定在模型训练截止之外的最新信息上。

## 何时使用

- 回答关于时事、近期发布或突发新闻的问题。
- 查找某个库、框架或 CLI 工具的最新版本。
- 在不知道确切 URL 时寻找文档或博文。
- 核实自模型训练以来可能已变化的事实。
- 在用 `WebFetch` 获取某个单页之前，先对某主题了解多方观点。

## 启用方式

- 可用性取决于提供方和模型：在 Anthropic API 和 Claude Platform on AWS 上可用；在 Microsoft Foundry 上需要 Anthropic 托管的部署；在 Google Cloud 上适用于 Claude 4+ 模型。
- 在 Amazon Bedrock 上不可用。
- 用 `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION` 将每个会话的调用次数上限设为 200。

## 参数

- `query` (string, 必填)：搜索查询。最小长度 2 个字符。询问「最新」或「最近」的信息时，在查询中包含当前年份，以确保结果新鲜。
- `allowed_domains` (array of strings, 可选)：将结果限制在这些域名内，例如 `["nodejs.org", "developer.mozilla.org"]`。适合在你信任特定来源时使用。
- `blocked_domains` (array of strings, 可选)：排除来自这些域名的结果。不要把同一域名同时传给 `allowed_domains` 和 `blocked_domains`。

## 示例

### 示例 1：带当前年份的版本查询

```
WebSearch(
  query="React 19 stable release date 2026",
  allowed_domains=["react.dev", "github.com"]
)
```

返回官方公告，避开低质量聚合站。

### 示例 2：排除嘈杂来源

```
WebSearch(
  query="kubernetes ingress-nginx CVE April 2026",
  blocked_domains=["pinterest.com", "medium.com"]
)
```

让结果聚焦于厂商公告和安全追踪器。

## 注意事项

- 当你在答案中使用了 `WebSearch`，必须在回复末尾追加 `Sources:` 段落，将每条引用结果以 `[Title](URL)` 形式的 Markdown 超链接列出。这是硬性要求，不可省略。
- `WebSearch` 仅对位于美国的用户可用。若该工具在你所在区域不可用，请退回到对已知 URL 使用 `WebFetch`，或请用户粘贴相关内容。
- 每次调用在一次往返内完成——你不能流式或分页。若首批结果不达预期，请精炼查询。
- 工具返回摘要和元数据，而非完整页面内容。要深入阅读某条命中，请用返回的 URL 后续调用 `WebFetch`。
- 对 CVE 或合规等安全敏感问题，使用 `allowed_domains` 强制权威来源；使用 `blocked_domains` 剔除镜像文档的 SEO 农场。
- 查询保持简短、关键词驱动。自然语言问句也可行，但往往返回对话式回答而非一手来源。
- 不要根据搜索直觉臆造 URL——始终运行搜索并引用工具实际返回的内容。
