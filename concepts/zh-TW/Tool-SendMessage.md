# SendMessage

## 定義

在團隊內的 agent 之間傳送訊息。用於直接通訊、廣播以及協議訊息（關閉請求 / 回應、計畫審批）。

## 參數

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `to` | string | 是 | 接收方：隊友名稱，或 `"*"` 廣播給所有人 |
| `message` | string / object | 是 | 純文字訊息或結構化協議物件 |
| `summary` | string | 否 | 在 UI 中顯示的 5-10 字預覽 |

## 訊息類型

### 純文字
隊友之間的直接訊息，用於協調、狀態更新和任務討論。

### 關閉請求
請求隊友優雅關閉：`{ type: "shutdown_request", reason: "..." }`

### 關閉回應
隊友批准或拒絕關閉：`{ type: "shutdown_response", approve: true/false }`

### 計畫審批回應
批准或拒絕隊友的計畫：`{ type: "plan_approval_response", approve: true/false }`

## 廣播與直發

- **直發**（`to: "隊友名稱"`）：傳送給特定隊友 — 大多數通訊的首選方式
- **廣播**（`to: "*"`）：傳送給所有隊友 — 僅在需要全團隊緊急通知時使用

## 相關工具

| 工具 | 用途 |
|------|------|
| `TeamCreate` | 建立新團隊 |
| `TeamDelete` | 完成後刪除團隊 |
| `Agent` | 生成加入團隊的隊友 |
| `TaskCreate` / `TaskUpdate` / `TaskList` | 管理共享任務列表 |
