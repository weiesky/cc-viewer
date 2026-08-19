# ToolSearch

为「延迟工具(deferred tools)」按需取回完整的 schema 定义,使其可被调用。工具数量很多时,部分工具不会一开始就加载,而是只以名字出现在 `<system-reminder>` 里;在取回 schema 之前只知道名字、没有参数定义,因此无法直接调用。`ToolSearch` 接收一个 query,在延迟工具清单里匹配,并把命中工具的完整 JSONSchema 定义返回到一个 `<functions>` 块中。一旦某工具的 schema 出现在结果里,它就和提示词顶部定义的工具一样可以正常调用。

## 何时使用

- 你需要某个延迟工具(它的名字出现在 `<system-reminder>` 里,但顶部工具列表中没有它的参数定义)。
- 你要使用某个 MCP 服务器的工具(如 Slack、Gmail、computer-use),而这些工具是按需加载的。
- 你不确定某能力对应的确切工具名,想用关键词把候选一次性搜出来。

如果某工具的 schema 已经在上下文里,就不要再搜一遍——直接调用即可。

## 启用方式

- 默认开启。
- 当 `ANTHROPIC_BASE_URL` 指向非 Anthropic 端点（除非设置了 `ENABLE_TOOL_SEARCH`）、设置了 `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`、模型缺少工具引用支持（Claude 4.5 之前的 Vertex AI 模型），或通过 `"deny": ["ToolSearch"]` 被拒绝时关闭。

## 参数

- `query` (string, 必填)：用于定位延迟工具的查询,支持三种写法:
  - `select:Read,Edit,Grep` —— 按确切名字精确取这几个工具。
  - `notebook jupyter` —— 关键词搜索,返回最多 `max_results` 个最佳匹配。
  - `+slack send` —— 要求工具名里必须含 `slack`,再用其余词排序。
- `max_results` (number, 可选)：返回的最大结果数,默认 5。

## 示例

### 示例 1：按名字精确取回

```
ToolSearch(query="select:WebFetch,WebSearch", max_results=5)
```

### 示例 2：关键词搜索

```
ToolSearch(query="notebook jupyter", max_results=5)
```

### 示例 3：一次性加载整套 MCP 工具

批量加载某个 MCP 服务器(如 computer-use)的全部工具时,用一次关键词搜索而不是逐个 `select:`——服务器名作为子串会命中该服务下的每个工具:

```
ToolSearch(query="computer-use", max_results=30)
```

## 注意事项

- 在调用一个延迟工具之前,必须先用 `ToolSearch` 把它的 schema 取回——否则直接调用会因为缺少参数定义而失败。
- 批量加载整套工具(如某个 MCP 服务的全部工具)时,优先用一次关键词搜索,而不是一个个 `select:`,以减少往返次数。
- schema 一旦取回,该工具就和普通工具完全一样可用;不要对同一工具重复搜索。
- 结果以 `<functions>` 块返回,每个工具是一行 `<function>{...}</function>` 定义,与提示词顶部工具列表的编码方式相同。
