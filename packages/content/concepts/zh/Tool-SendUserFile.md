# SendUserFile

向用户发送一个或多个文件——生成的产物、截图、报告——并控制客户端如何呈现它们。

## 何时使用

- 你生成了用户需要的文件（报告、图片、HTML 页面），希望把它呈现出来，而不只是提及路径。
- 以附件回复（`status="normal"`），或主动呈现用户没有要求但现在需要看到的内容（`status="proactive"`）。

## 启用方式

- 仅在连接了 Remote Control 客户端，或会话运行于受管云端环境（如 Claude Code on the web）时可用。
- 在 Amazon Bedrock、Google Cloud 或 Microsoft Foundry 上不可用。
- 需要会话允许发送文件（受设置/功能门控的能力）；brief 模式下不提供。

## 参数

- `files` (array of strings, 必填)：要发给用户的文件路径（绝对路径或相对于 cwd）。即使只有一个文件也始终传数组。
- `caption` (string, 可选)：文件（们）的简短说明文字。
- `status` (string, 必填)：主动呈现用户没有要求且现在需要看到的文件时用 `proactive`——如生成的产物、完成的报告；回复用户刚说的话时用 `normal`。
- `display` (string, 可选)：`render` 在侧边面板中内联打开文件（HTML、SVG、Mermaid、图片、PDF）；`attach` 只显示下载卡片（用户将保存并在别处打开的交付物）。省略则让客户端按文件类型决定。

## 示例

### 示例 1：交付生成的报告

```
SendUserFile(
  files=["./out/weekly-report.html"],
  caption="Weekly usage report",
  status="proactive",
  display="render"
)
```

## 注意事项

- 用户会保存并在另一个应用中打开的文件选择 `display="attach"`；应该立即查看的内容用 `render`。
