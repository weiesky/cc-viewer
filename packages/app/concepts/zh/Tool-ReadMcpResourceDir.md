# ReadMcpResourceDir

按 URI 列出一个已连接 MCP 服务器暴露的目录型资源的条目。

## 何时使用

- MCP 服务器以层级方式组织资源，你需要枚举该层级的一层。
- 你想在用 `ReadMcpResource` 逐个读取之前先浏览。

## 启用方式

- 始终启用，但不暴露在模型的工具列表中——面向 thin-client / sidecar 使用。

## 参数

- `server` (string, 必填)：MCP 服务器名称。
- `uri` (string, 必填)：要列出的目录资源 URI。

## 示例

### 示例 1：列出资源目录

```
ReadMcpResourceDir(server="filesystem", uri="file:///project/src/")
```

返回服务器在该目录 URI 下暴露的子条目。

## 注意事项

- 只有把资源建模为目录的服务器才支持本工具；扁平服务器会返回错误或空列表——此时回退到 `ListMcpResources`。
- 与 `ReadMcpResource` 结合使用，深入看起来相关的条目。
