# TeamCreate

## 定義

建立一個新的團隊來協調多個 agent 協同工作。團隊透過共享任務列表和 agent 間訊息傳遞實現並行任務執行。

## 參數

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `team_name` | string | 是 | 新團隊的名稱 |
| `description` | string | 否 | 團隊描述 / 用途 |
| `agent_type` | string | 否 | 團隊負責人的類型 / 角色 |

## 建立的內容

- **團隊設定檔**：`~/.claude/teams/{team-name}/config.json` — 儲存成員清單和元數據
- **任務列表目錄**：`~/.claude/tasks/{team-name}/` — 所有隊友共享的任務列表

團隊與任務列表為一對一對應關係。

## 團隊工作流程

1. **TeamCreate** — 建立團隊及其任務列表
2. **TaskCreate** — 為團隊定義任務
3. **Agent**（帶 `team_name` + `name`）— 生成加入團隊的隊友
4. **TaskUpdate** — 透過 `owner` 將任務分配給隊友
5. 隊友處理任務，透過 **SendMessage** 進行通訊
6. 完成後關閉隊友，然後用 **TeamDelete** 清理資源

## 相關工具

| 工具 | 用途 |
|------|------|
| `TeamDelete` | 刪除團隊和任務目錄 |
| `SendMessage` | 團隊內 agent 間的通訊 |
| `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` | 管理共享任務列表 |
| `Agent` | 生成加入團隊的隊友 |
