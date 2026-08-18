# SendFile

向另一个 Claude Code 会话——`ListAgents` 列出的对等方，或一个显式的会话地址——发送一个或多个文件。

## 何时使用

- 对等会话需要你工作目录中的文件（报告、补丁、fixture）来继续它自己的任务。
- 你在跨会话协调工作，希望交接产物而不只是文本（文本用 `SendMessage`）。

## 参数

- `to` (string, 必填)：接收方——来自 `ListAgents` 的对等会话名，或显式的 `uds:<socket>` / `bridge:<session id>` 地址。
- `files` (array of strings, 必填)：要发送的文件路径（绝对路径或相对于 cwd）。即使只有一个文件也始终传数组。1–16 个文件，每个最多 30 MiB。
- `message` (string, 可选)：随文件一起发送的简短消息。

## 示例

### 示例 1：向对等会话发送报告

```
SendFile(
  to="teammate-a",
  files=["./dist/report.html"],
  message="The analysis you asked for"
)
```

## 注意事项

- 会话必须可用跨会话文件传输；不可用时，校验会以 "Cross-session file transfer is not available in this session." 失败。
- 传输到远程机器可能需要额外审批。
- 读取文件内容是发送的一部分——若权限规则禁用了文件读取，则会被拒绝。
