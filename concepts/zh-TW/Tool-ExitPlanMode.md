# ExitPlanMode

## 定義

退出規劃模式並將方案提交給使用者審批。方案內容從之前寫入的計畫檔案中讀取。

## 參數

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `allowedPrompts` | array | 否 | 實施方案所需的權限描述列表 |

`allowedPrompts` 陣列中每個元素：

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `tool` | enum | 是 | 適用的工具，目前僅支援 `Bash` |
| `prompt` | string | 是 | 操作的語義描述（如 "run tests"、"install dependencies"） |

## 使用場景

**適合使用：**
- 規劃模式中方案已完成，準備提交使用者審批
- 僅用於需要撰寫程式碼的實施任務

**不適合使用：**
- 純研究/探索任務——不需要退出規劃模式
- 想問使用者「方案可以嗎？」——這正是此工具的功能，不要用 AskUserQuestion 來問

## 注意事項

- 此工具不接受方案內容作為參數——它從之前寫入的計畫檔案中讀取
- 使用者會看到計畫檔案的內容來審批
- 不要在呼叫此工具前用 AskUserQuestion 問「方案是否可以」，這是重複的
- 不要在問題中提及「計畫」，因為使用者在 ExitPlanMode 之前看不到計畫內容

## 在 cc-viewer 中的意義

ExitPlanMode 呼叫標誌著規劃階段的結束。在請求日誌中，此呼叫之後的請求通常轉為實施性操作（Edit、Write、Bash 等）。

## 原文

<textarea readonly>Use this tool when you are in plan mode and have finished writing your plan to the plan file and are ready for user approval.

## How This Tool Works
- You should have already written your plan to the plan file specified in the plan mode system message
- This tool does NOT take the plan content as a parameter - it will read the plan from the file you wrote
- This tool simply signals that you're done planning and ready for the user to review and approve
- The user will see the contents of your plan file when they review it

## When to Use This Tool
IMPORTANT: Only use this tool when the task requires planning the implementation steps of a task that requires writing code. For research tasks where you're gathering information, searching files, reading files or in general trying to understand the codebase - do NOT use this tool.

## Before Using This Tool
Ensure your plan is complete and unambiguous:
- If you have unresolved questions about requirements or approach, use AskUserQuestion first (in earlier phases)
- Once your plan is finalized, use THIS tool to request approval

**Important:** Do NOT use AskUserQuestion to ask "Is this plan okay?" or "Should I proceed?" - that's exactly what THIS tool does. ExitPlanMode inherently requests user approval of your plan.

## Examples

1. Initial task: "Search for and understand the implementation of vim mode in the codebase" - Do not use the exit plan mode tool because you are not planning the implementation steps of a task.
2. Initial task: "Help me implement yank mode for vim" - Use the exit plan mode tool after you have finished planning the implementation steps of the task.
3. Initial task: "Add a new feature to handle user authentication" - If unsure about auth method (OAuth, JWT, etc.), use AskUserQuestion first, then use exit plan mode tool after clarifying the approach.
</textarea>
