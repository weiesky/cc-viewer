# SendUserMessage

向用户发送消息——brief 风格会话中的主要可见输出通道。也以其旧版别名 `Brief` 为人所知。

## 何时使用

- 回复用户刚说的话（`status="normal"`）。
- 主动呈现用户没有要求但现在需要看到的内容——他们离开时任务完成、你遇到的阻碍、未经请求的状态更新（`status="proactive"`）。

## 参数

在 brief 模式下：

- `message` (string, 必填)：给用户的消息。支持 markdown 格式。
- `attachments` (array, 可选)：随消息显示的附件。每个条目要么是本地可读文件的路径（绝对路径或相对于 cwd），要么是从设备工具（如 `attach_file`）获得的预先解析的 `{file_uuid, file_name, size, is_image}` 对象。
- `status` (string, 必填)：用户现在需要的未经请求的更新用 `proactive`；回复用户时用 `normal`。

在非 brief 构建中只有 `message` 可用。

## 示例

### 示例 1：主动发送完成通知

```
SendUserMessage(
  message="The migration finished — 42 files updated, tests green.",
  status="proactive"
)
```

## 注意事项

- 仅在 brief 模式或相应功能上线后启用；大多数交互式 CLI 会话直接与用户对话。
- 谨慎使用 `proactive`——它用于确实需要用户现在注意的事情。
