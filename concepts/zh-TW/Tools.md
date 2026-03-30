# Claude Code 工具一覽

Claude Code 透過 Anthropic API 的 tool_use 機制向模型提供一組內建工具。每次 MainAgent 請求的 `tools` 陣列中包含這些工具的完整 JSON Schema 定義，模型在回應中透過 `tool_use` content block 呼叫它們。

以下是全部工具的分類索引。

## Agent 系統

| 工具 | 用途 |
|------|------|
| [Task](Tool-Task.md) | 啟動子 agent（SubAgent）處理複雜多步驟任務 |
| [TaskOutput](Tool-TaskOutput.md) | 取得後台任務的輸出 |
| [TaskStop](Tool-TaskStop.md) | 停止正在執行的後台任務 |
| [TaskCreate](Tool-TaskCreate.md) | 建立結構化任務列表條目 |
| [TaskGet](Tool-TaskGet.md) | 取得任務詳情 |
| [TaskUpdate](Tool-TaskUpdate.md) | 更新任務狀態、依賴關係等 |
| [TaskList](Tool-TaskList.md) | 列出所有任務 |

## 檔案操作

| 工具 | 用途 |
|------|------|
| [Read](Tool-Read.md) | 讀取檔案內容（支援文字、圖片、PDF、Jupyter notebook） |
| [Edit](Tool-Edit.md) | 透過精確字串替換編輯檔案 |
| [Write](Tool-Write.md) | 寫入或覆寫檔案 |
| [NotebookEdit](Tool-NotebookEdit.md) | 編輯 Jupyter notebook 儲存格 |

## 搜尋

| 工具 | 用途 |
|------|------|
| [Glob](Tool-Glob.md) | 按檔案名稱模式匹配搜尋檔案 |
| [Grep](Tool-Grep.md) | 基於 ripgrep 的檔案內容搜尋 |

## 終端

| 工具 | 用途 |
|------|------|
| [Bash](Tool-Bash.md) | 執行 shell 命令 |

## Web

| 工具 | 用途 |
|------|------|
| [WebFetch](Tool-WebFetch.md) | 擷取網頁內容並用 AI 處理 |
| [WebSearch](Tool-WebSearch.md) | 搜尋引擎查詢 |

## 規劃與互動

| 工具 | 用途 |
|------|------|
| [EnterPlanMode](Tool-EnterPlanMode.md) | 進入規劃模式，設計實施方案 |
| [ExitPlanMode](Tool-ExitPlanMode.md) | 退出規劃模式並提交方案供使用者審批 |
| [AskUserQuestion](Tool-AskUserQuestion.md) | 向使用者提問以取得澄清或決策 |

## 擴充

| 工具 | 用途 |
|------|------|
| [Skill](Tool-Skill.md) | 執行技能（slash command） |

## IDE 整合

| 工具 | 用途 |
|------|------|
| [getDiagnostics](Tool-getDiagnostics.md) | 取得 VS Code 語言診斷資訊 |
| [executeCode](Tool-executeCode.md) | 在 Jupyter kernel 中執行程式碼 |
