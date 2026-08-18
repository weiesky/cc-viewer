# LSP

向语言服务器协议（LSP）服务器查询代码智能信息——定义、引用、悬停、符号、实现以及调用层级。因为它在语义层面理解代码，所以比纯文本搜索更精确。

## 何时使用

- 跳转到符号定义（`goToDefinition`）或查找其全部引用（`findReferences`）
- 读取符号的类型签名 / 文档（`hover`）
- 列出单个文件中的符号（`documentSymbol`）或在整个项目中搜索符号（`workspaceSymbol`）
- 查找接口或抽象方法的实现（`goToImplementation`）
- 遍历函数的调用层级（`prepareCallHierarchy`、`incomingCalls`、`outgoingCalls`）

## 启用方式

- 在安装该语言的代码智能插件之前不活动（服务器二进制文件单独安装）。
- 仅当 LSP 客户端已连接时，此工具才会出现。

## 参数

- `operation` (string, 必填)：上述操作之一。
- `filePath` (string, 必填)：要操作的文件。
- `line` (number, 必填)：从 1 开始的行号，与编辑器中显示的一致。
- `character` (number, 必填)：从 1 开始的字符偏移，与编辑器中显示的一致。

## 注意事项

- 需要为该文件类型配置好 LSP 服务器，否则调用会返回错误。
- 行号与字符偏移均从 1 开始（编辑器坐标），而非从 0 开始。
- 当你需要语义级导航（真正的定义/引用）而非文本匹配时，优先使用 LSP 而非 `Grep`。

## 相关概念

- 在导航与修改代码时与 `Read`、`Edit` 配合使用。
