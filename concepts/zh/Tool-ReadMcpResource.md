# ReadMcpResource

按 URI 读取一个已连接 MCP（Model Context Protocol）服务器暴露的单个资源。

## 何时使用

- MCP 服务器公示了某个资源（文件、记录、文档），你需要其内容进入上下文。
- 你有一个具体的资源 URI——来自 `ListMcpResources`、服务器文档或先前的工具结果。

## 参数

- `server` (string, 必填)：MCP 服务器名称。
- `uri` (string, 必填)：要读取的资源 URI。

## 示例

### 示例 1：按 URI 读取服务器资源

```
ReadMcpResource(server="github", uri="file:///repo/docs/architecture.md")
```

返回 `github` MCP 服务器提供的资源内容。

## 注意事项

- 若不清楚服务器暴露了哪些资源，先用 `ListMcpResources`；目录型列表用 `ReadMcpResourceDir`。
- URI scheme 因服务器而异（`file://`、`https://`、自定义 scheme）——查看目标服务器公示的内容。
