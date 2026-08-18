# ListMcpResources

列出已连接 MCP 服务器暴露的资源，可选按单个服务器过滤。

## 何时使用

- 你需要在读取之前发现 MCP 服务器提供了哪些资源（文件、记录、文档）。
- 你想总览所有已连接服务器的全部资源。

## 参数

- `server` (string, 可选)：用于过滤资源的服务器名称。省略则列出所有已连接服务器的资源。

## 示例

### 示例 1：列出全部

```
ListMcpResources()
```

### 示例 2：列出单个服务器的资源

```
ListMcpResources(server="github")
```

## 注意事项

- 这是发现步骤：把感兴趣的 URI 交给 `ReadMcpResource`（单个资源）或 `ReadMcpResourceDir`（目录列表）。
- 服务器在会话生命周期内会连接和断开；若某服务器刚被添加，请重新列出。
