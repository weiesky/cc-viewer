# Claude Code 工具一覽

Claude Code 透過 Anthropic API 的 tool_use 機制向模型提供一組內建工具。每次 MainAgent 請求的 `tools` 陣列中包含這些工具的完整 JSON Schema 定義，模型在回應中透過 `tool_use` content block 呼叫它們。

以下是全部工具的分類索引。

## Agent 系統

| 工具 | 用途 |
|------|------|
| [Agent](Tool-Agent.md) | 啟動子 agent（SubAgent）處理複雜多步驟任務 |
| [TaskOutput](Tool-TaskOutput.md) | 取得後台任務的輸出 |
| [TaskStop](Tool-TaskStop.md) | 停止正在執行的後台任務 |
| [TaskCreate](Tool-TaskCreate.md) | 建立結構化任務列表條目 |
| [TaskGet](Tool-TaskGet.md) | 取得任務詳情 |
| [TaskUpdate](Tool-TaskUpdate.md) | 更新任務狀態、依賴關係等 |
| [TaskList](Tool-TaskList.md) | 列出所有任務 |
| [ListAgents](Tool-ListAgents.md) | 列出工作階段中可用的 agent |

## 檔案操作

| 工具 | 用途 |
|------|------|
| [Read](Tool-Read.md) | 讀取檔案內容（支援文字、圖片、PDF、Jupyter notebook） |
| [Edit](Tool-Edit.md) | 透過精確字串替換編輯檔案 |
| [Write](Tool-Write.md) | 寫入或覆寫檔案 |
| [NotebookEdit](Tool-NotebookEdit.md) | 編輯 Jupyter notebook 儲存格 |

## 團隊與協作

| 工具 | 用途 |
|------|------|
| [SendMessage](Tool-SendMessage.md) | 向另一個 agent 發送訊息 |
| [Workflow](Tool-Workflow.md) | 執行確定性多 agent 編排指令碼 |
| [Monitor](Tool-Monitor.md) | 將長時間執行指令碼的事件串流推送為通知 |
| [SendFile](Tool-SendFile.md) | 將檔案傳送給另一個 Claude Code 工作階段 |
| [SendUserFile](Tool-SendUserFile.md) | 將檔案傳送給使用者 |
| [SendUserMessage](Tool-SendUserMessage.md) | 向使用者傳送訊息（舊版 Brief 工具） |
| [EndConversation](Tool-EndConversation.md) | 結束目前對話 |

## 搜尋

| 工具 | 用途 |
|------|------|
| [Glob](Tool-Glob.md) | 按檔案名稱模式匹配搜尋檔案 |
| [Grep](Tool-Grep.md) | 基於 ripgrep 的檔案內容搜尋 |
| [ToolSearch](Tool-ToolSearch.md) | 按需搜尋並載入延遲/MCP 工具 |

## 終端

| 工具 | 用途 |
|------|------|
| [Bash](Tool-Bash.md) | 執行 shell 命令 |
| [REPL](Tool-REPL.md) | 在持久性 Node.js REPL 中執行 JavaScript |

## Web

| 工具 | 用途 |
|------|------|
| [WebFetch](Tool-WebFetch.md) | 擷取網頁內容並用 AI 處理 |
| [WebSearch](Tool-WebSearch.md) | 搜尋引擎查詢 |
| [Artifact](Tool-Artifact.md) | 將 HTML/Markdown 檔案發佈為託管的 claude.ai 網頁 |
| [DesignSync](Tool-DesignSync.md) | 將本地組件庫與 claude.ai 設計系統專案同步 |

## 規劃與互動

| 工具 | 用途 |
|------|------|
| [EnterPlanMode](Tool-EnterPlanMode.md) | 進入規劃模式，設計實施方案 |
| [ExitPlanMode](Tool-ExitPlanMode.md) | 退出規劃模式並提交方案供使用者審批 |
| [AskUserQuestion](Tool-AskUserQuestion.md) | 向使用者提問以取得澄清或決策 |
| [ReportFindings](Tool-ReportFindings.md) | 將程式碼審查發現報告為主機 UI 的類型化清單 |
| [TodoWrite](Tool-TodoWrite.md) | 為工作階段寫入結構化待辦清單 |
| [SendFeedback](Tool-SendFeedback.md) | 向 Anthropic 發送關於 Claude Code 的結構化回饋 |
| [Projects](Tool-Projects.md) | 管理專案知識庫文件 |
| [ProposeGoal](Tool-ProposeGoal.md) | 為工作階段提出可驗證的完成目標 |

## 工作樹

| 工具 | 用途 |
|------|------|
| [EnterWorktree](Tool-EnterWorktree.md) | 為工作階段建立或進入隔離的 git worktree |
| [ExitWorktree](Tool-ExitWorktree.md) | 離開 worktree 工作階段，保留或刪除它 |

## 排程與通知

| 工具 | 用途 |
|------|------|
| [CronCreate](Tool-CronCreate.md) | 在 cron 運算式上排程提示（循環或一次性） |
| [CronDelete](Tool-CronDelete.md) | 取消已排程的 cron 作業 |
| [CronList](Tool-CronList.md) | 列出已排程的 cron 作業 |
| [ScheduleWakeup](Tool-ScheduleWakeup.md) | 透過排程下一次喚醒來自行調整 /loop 反覆運算 |
| [PushNotification](Tool-PushNotification.md) | 向使用者發送桌面/行動通知 |
| [RemoteTrigger](Tool-RemoteTrigger.md) | 管理 claude.ai 遠端觸發例程 |
| [ReadNotifications](Tool-ReadNotifications.md) | 讀取待處理的工作階段通知 |

## 擴充

| 工具 | 用途 |
|------|------|
| [Skill](Tool-Skill.md) | 執行技能（slash command） |

## MCP 與擴充功能

| 工具 | 用途 |
|------|------|
| [ListMcpResources](Tool-ListMcpResources.md) | 列出已連線 MCP 伺服器公開的資源 |
| [ReadMcpResource](Tool-ReadMcpResource.md) | 依 URI 讀取單一 MCP 伺服器資源 |
| [ReadMcpResourceDir](Tool-ReadMcpResourceDir.md) | 依 URI 列出目錄式 MCP 資源 |
| [SearchMcpRegistry](Tool-SearchMcpRegistry.md) | 以關鍵字搜尋 MCP connector 登錄檔 |
| [SuggestConnectors](Tool-SuggestConnectors.md) | 從登錄檔搜尋結果解析 connector 詳情 |
| [ListConnectors](Tool-ListConnectors.md) | 列出已安裝的 MCP connector |
| [SuggestPluginInstall](Tool-SuggestPluginInstall.md) | 渲染內聯外掛安裝卡片 |
| [SuggestSkills](Tool-SuggestSkills.md) | 渲染可新增 skills 的卡片 |
| [ListPlugins](Tool-ListPlugins.md) | 列出已啟用的 claude.ai 外掛 |
| [ListSkills](Tool-ListSkills.md) | 列出已啟用的 claude.ai skills |

## IDE 整合

| 工具 | 用途 |
|------|------|
| [LSP](Tool-LSP.md) | 語言伺服器查詢（定義、參考、符號） |
