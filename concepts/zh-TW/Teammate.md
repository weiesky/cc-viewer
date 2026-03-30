# Teammate

## 定義

Teammate 是 Claude Code Agent Team 模式下的協作 agent。當主 agent 透過 `TeamCreate` 建立團隊並使用 `Agent` 工具生成 teammate 時，每個 teammate 作為獨立的 agent 程序運行，擁有自己的上下文視窗和工具集，透過 `SendMessage` 與團隊成員通訊。

## 與 SubAgent 的區別

| 特徵 | Teammate | SubAgent |
|------|----------|----------|
| 生命週期 | 持續存在，可接收多次訊息 | 一次性任務，完成即銷毀 |
| 通訊方式 | SendMessage 雙向訊息 | 父→子單向呼叫，回傳結果 |
| 上下文 | 獨立完整上下文，跨輪次保留 | 隔離的任務上下文 |
| 協作模式 | 團隊協作，可相互通訊 | 層級結構，只與父 agent 互動 |
| 任務類型 | 複雜的多步驟任務 | 搜尋、探索等單一任務 |

## 行為

- 由主 agent（team lead）透過 `Agent` 工具建立並分配 `team_name`
- 透過 `TaskList` / `TaskGet` / `TaskUpdate` 共享任務列表
- 每輪執行完畢後進入 idle 狀態，等待新訊息喚醒
- 可透過 `shutdown_request` 優雅終止

## 統計面板說明

Teammate 統計面板顯示每個 teammate 的 API 呼叫次數。`Name` 欄為 teammate 名稱（如 `reviewer-security`、`reviewer-pipeline`），`次數` 欄為該 teammate 產生的 API 請求總數。
