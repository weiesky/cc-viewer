# Agent

## 定義

啟動一個子 agent（SubAgent）來自主處理複雜的多步驟任務。子 agent 是獨立的子程序，擁有各自專用的工具集和上下文。Agent 是新版 Claude Code 中 Task 工具的重新命名版本。

## 參數

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `prompt` | string | 是 | 子 agent 要執行的任務描述 |
| `description` | string | 是 | 3-5 個詞的簡短摘要 |
| `subagent_type` | string | 是 | 子 agent 類型，決定可用工具集 |
| `model` | enum | 否 | 指定模型（sonnet / opus / haiku），預設繼承父級 |
| `max_turns` | integer | 否 | 最大 agentic 輪次數 |
| `run_in_background` | boolean | 否 | 是否背景執行，背景任務回傳 output_file 路徑 |
| `resume` | string | 否 | 要恢復的 agent ID，從上次執行繼續。適用於在不遺失上下文的情況下接續之前的子 agent |
| `isolation` | enum | 否 | 隔離模式，`worktree` 建立臨時 git worktree |

## 子 agent 類型

| 類型 | 用途 | 可用工具 |
|------|------|----------|
| `Bash` | 命令執行，git 操作 | Bash |
| `general-purpose` | 通用多步驟任務 | 全部工具 |
| `Explore` | 快速探索程式碼庫 | 除 Agent/Edit/Write/NotebookEdit/ExitPlanMode 外的所有工具 |
| `Plan` | 設計實施方案 | 除 Agent/Edit/Write/NotebookEdit/ExitPlanMode 外的所有工具 |
| `claude-code-guide` | Claude Code 使用指南問答 | Glob, Grep, Read, WebFetch, WebSearch |
| `statusline-setup` | 設定狀態列 | Read, Edit |

## 使用場景

**適合使用：**
- 需要多步驟自主完成的複雜任務
- 程式碼庫探索和深度研究（使用 Explore 類型）
- 需要隔離環境的並行工作
- 需要背景執行的長時間任務

**不適合使用：**
- 讀取特定檔案路徑——直接用 Read 或 Glob
- 在 2-3 個已知檔案中搜尋——直接用 Read
- 搜尋特定類別定義——直接用 Glob

## 注意事項

- 子 agent 完成後回傳單條訊息，其結果對使用者不可見，需要主 agent 轉述
- 可以在單條訊息中發起多個並行 Agent 呼叫以提高效率
- 背景任務透過 TaskOutput 工具檢查進度
- Explore 類型比直接呼叫 Glob/Grep 慢，僅在簡單搜尋不夠時使用
- 長時間執行且不需要立即結果的任務建議使用 `run_in_background: true`；需要結果後才能繼續時使用前台模式（預設）
- `resume` 參數允許繼續之前啟動的子 agent 會話，保留其累積的上下文

## 在 cc-viewer 中的意義

Agent 是新版 Claude Code 中 Task 工具的新名稱。Agent 呼叫會產生 SubAgent 請求鏈路，在請求列表中可以看到獨立於 MainAgent 的子請求序列。SubAgent 請求通常具有精簡的 system prompt 和較少的工具定義，與 MainAgent 形成明顯對比。在 cc-viewer 中，根據錄製對話時使用的 Claude Code 版本不同，可能會出現 `Task` 或 `Agent` 兩種工具名稱。
