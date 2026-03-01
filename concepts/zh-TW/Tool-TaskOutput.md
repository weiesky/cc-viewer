# TaskOutput

## 定義

取得正在執行或已完成的後台任務的輸出。適用於後台 shell、非同步 agent 和遠端會話。

## 參數

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `task_id` | string | 是 | 任務 ID |
| `block` | boolean | 是 | 是否阻塞等待任務完成，預設 `true` |
| `timeout` | number | 是 | 最大等待時間（毫秒），預設 30000，最大 600000 |

## 使用場景

**適合使用：**
- 檢查透過 Task（`run_in_background: true`）啟動的後台 agent 的進度
- 取得後台 Bash 命令的執行結果
- 等待非同步任務完成並取得輸出

**不適合使用：**
- 前台任務——前台任務直接回傳結果，無需此工具

## 注意事項

- `block: true` 會阻塞直到任務完成或逾時
- `block: false` 用於非阻塞檢查當前狀態
- 任務 ID 可透過 `/tasks` 命令查找
- 適用於所有任務類型：後台 shell、非同步 agent、遠端會話

## 在 cc-viewer 中的意義

TaskOutput 呼叫本身不產生 API 請求，它是 Claude Code 內部的任務管理操作，不會出現在請求日誌中。

## 原文

<textarea readonly>- Retrieves output from a running or completed task (background shell, agent, or remote session)
- Takes a task_id parameter identifying the task
- Returns the task output along with status information
- Use block=true (default) to wait for task completion
- Use block=false for non-blocking check of current status
- Task IDs can be found using the /tasks command
- Works with all task types: background shells, async agents, and remote sessions</textarea>
