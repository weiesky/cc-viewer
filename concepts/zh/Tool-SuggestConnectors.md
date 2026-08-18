# SuggestConnectors

解析 `SearchMcpRegistry` 返回的 `directoryUuid` 值对应的完整连接器载荷，以便向用户提供可启用的具体连接器。

## 何时使用

- 在 `SearchMcpRegistry` 返回候选连接器之后，取回其完整详情用于展示。

## 参数

- `uuids` (array of strings, 必填)：要解析的 `directoryUuid` 或 `server_id` 值。1–32 项，每项 1–64 个字符。

## 示例

### 示例 1：解析两个注册表命中

```
SuggestConnectors(uuids=["d290f1ee-6c54-4b01-90e6-d701748f0851", "a1b2c3d4-0000-4000-8000-abcdefabcdef"])
```

## 注意事项

- 永远不要猜测 UUID——只解析 `SearchMcpRegistry` 返回的标识符。
- 本工具自身不连接任何东西；启用连接器在带外进行。
- 仅在第一方 API 的远程（claude.ai）会话中可用。
