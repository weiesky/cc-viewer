# SearchMcpRegistry

按关键词搜索 MCP 连接器注册表，以发现可能有助于完成任务的连接器。

## 何时使用

- 任务会受益于某个外部服务（数据库、issue 跟踪器、SaaS API），而你想确认是否存在对应的 MCP 连接器。
- 用户点名某产品并要求连接它——在注册表中搜索匹配的连接器。

## 启用方式

- 仅在第一方 API 的远程（claude.ai）会话中可用。

## 参数

- `keywords` (array of strings, 必填)：描述用户意图或所点名产品的关键词短语。1–8 项，每项 1–64 个字符。

## 示例

### 示例 1：为点名产品找连接器

```
SearchMcpRegistry(keywords=["linear", "issue tracker"])
```

返回连接器与关键词匹配的注册表条目。用 `SuggestConnectors` 解析完整的连接器详情。

## 注意事项

- 只读且并发安全；结果大小有上限。
- 搜索不会安装任何东西——纯粹是发现。
