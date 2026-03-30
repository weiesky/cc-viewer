# TeamDelete

## 定義

在多 agent 協作工作完成後，刪除團隊及其關聯的任務目錄。是 TeamCreate 的清理對應操作。

## 行為

- 刪除團隊目錄：`~/.claude/teams/{team-name}/`
- 刪除任務目錄：`~/.claude/tasks/{team-name}/`
- 清除當前會話中的團隊上下文

**重要**：如果團隊中仍有活躍成員，TeamDelete 將會失敗。必須先透過 SendMessage 發送關閉請求，優雅地關閉所有隊友。

## 典型用法

TeamDelete 在團隊工作流程結束時呼叫：

1. 所有任務已完成
2. 透過 `SendMessage` 發送 `shutdown_request` 關閉隊友
3. **TeamDelete** 刪除團隊和任務目錄

## 相關工具

| 工具 | 用途 |
|------|------|
| `TeamCreate` | 建立新團隊及其任務列表 |
| `SendMessage` | 與隊友通訊 / 發送關閉請求 |
| `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` | 管理共享任務列表 |
| `Agent` | 生成加入團隊的隊友 |
