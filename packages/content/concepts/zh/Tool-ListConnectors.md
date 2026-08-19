# ListConnectors

列出用户 claude.ai 组织已安装的 MCP 连接器，可选按关键词过滤。

## 何时使用

- 在建议新连接器之前，你需要知道已安装了哪些。
- 用户询问他们组织有哪些集成。

## 启用方式

- 仅在第一方 API 的远程（claude.ai）会话中可用。

## 参数

- `keywords` (array of strings, 可选)：过滤列表——最多 8 项，每项 1–64 个字符。省略则列出全部。

## 示例

### 示例 1：列出所有已安装连接器

```
ListConnectors()
```

### 示例 2：按关键词过滤

```
ListConnectors(keywords=["github"])
```

## 注意事项

- 与 `SearchMcpRegistry`（发现）和 `SuggestConnectors`（详情）搭配，构成完整的寻找-启用流程。
