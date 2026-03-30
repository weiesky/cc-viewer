# SendMessage

## 定义

在团队内的 agent 之间发送消息。用于直接通信、广播以及协议消息（关闭请求/响应、计划审批）。

## 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `to` | string | 是 | 接收方：队友名称，或 `"*"` 广播给所有人 |
| `message` | string / object | 是 | 纯文本消息或结构化协议对象 |
| `summary` | string | 否 | 在 UI 中显示的 5-10 字预览 |

## 消息类型

### 纯文本
队友之间的直接消息，用于协调、状态更新和任务讨论。

### 关闭请求
请求队友优雅关闭：`{ type: "shutdown_request", reason: "..." }`

### 关闭响应
队友批准或拒绝关闭：`{ type: "shutdown_response", approve: true/false }`

### 计划审批响应
批准或拒绝队友的计划：`{ type: "plan_approval_response", approve: true/false }`

## 广播与直发

- **直发**（`to: "队友名称"`）：发送给特定队友 — 大多数通信的首选方式
- **广播**（`to: "*"`）：发送给所有队友 — 仅在需要全团队紧急通知时使用

## 相关工具

| 工具 | 用途 |
|------|------|
| `TeamCreate` | 创建新团队 |
| `TeamDelete` | 完成后删除团队 |
| `Agent` | 生成加入团队的队友 |
| `TaskCreate` / `TaskUpdate` / `TaskList` | 管理共享任务列表 |
