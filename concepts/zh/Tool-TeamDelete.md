# TeamDelete

## 定义

在多 agent 协作工作完成后，删除团队及其关联的任务目录。是 TeamCreate 的清理对应操作。

## 行为

- 删除团队目录：`~/.claude/teams/{team-name}/`
- 删除任务目录：`~/.claude/tasks/{team-name}/`
- 清除当前会话中的团队上下文

**重要**：如果团队中仍有活跃成员，TeamDelete 将会失败。必须先通过 SendMessage 发送关闭请求，优雅地关闭所有队友。

## 典型用法

TeamDelete 在团队工作流程结束时调用：

1. 所有任务已完成
2. 通过 `SendMessage` 发送 `shutdown_request` 关闭队友
3. **TeamDelete** 删除团队和任务目录

## 相关工具

| 工具 | 用途 |
|------|------|
| `TeamCreate` | 创建新团队及其任务列表 |
| `SendMessage` | 与队友通信 / 发送关闭请求 |
| `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` | 管理共享任务列表 |
| `Agent` | 生成加入团队的队友 |
