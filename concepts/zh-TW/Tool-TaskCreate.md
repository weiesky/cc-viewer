# TaskCreate

## 定義

建立結構化的任務列表條目，用於追蹤進度、組織複雜任務，並向使用者展示工作進展。

## 參數

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `subject` | string | 是 | 簡短的任務標題，使用祈使句（如 "Fix authentication bug"） |
| `description` | string | 是 | 詳細描述，包含上下文和驗收標準 |
| `activeForm` | string | 否 | 進行中時顯示的現在進行式文字（如 "Fixing authentication bug"） |
| `metadata` | object | 否 | 附加到任務的任意中繼資料 |

## 使用場景

**適合使用：**
- 複雜的多步驟任務（3 步以上）
- 使用者提供了多個待辦事項
- 在規劃模式中追蹤工作
- 使用者明確要求使用 todo 列表

**不適合使用：**
- 單一簡單任務
- 3 步以內的簡單操作
- 純對話或資訊查詢

## 注意事項

- 所有新建任務的初始狀態為 `pending`
- `subject` 使用祈使句（"Run tests"），`activeForm` 使用現在進行式（"Running tests"）
- 建立任務後可透過 TaskUpdate 設定依賴關係（blocks/blockedBy）
- 建立前應先呼叫 TaskList 檢查是否有重複任務

## 在 cc-viewer 中的意義

TaskCreate 是 Claude Code 內部的任務管理操作，不產生獨立的 API 請求。但在 Chat Mode 中可以看到模型呼叫此工具的 tool_use block。

## 原文

<textarea readonly>Use this tool to create a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

## When to Use This Tool

Use this tool proactively in these scenarios:

- Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
- Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
- Plan mode - When using plan mode, create a task list to track the work
- User explicitly requests todo list - When the user directly asks you to use the todo list
- User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
- After receiving new instructions - Immediately capture user requirements as tasks
- When you start working on a task - Mark it as in_progress BEFORE beginning work
- After completing a task - Mark it as completed and add any new follow-up tasks discovered during implementation

## When NOT to Use This Tool

Skip using this tool when:
- There is only a single, straightforward task
- The task is trivial and tracking it provides no organizational benefit
- The task can be completed in less than 3 trivial steps
- The task is purely conversational or informational

NOTE that you should not use this tool if there is only one trivial task to do. In this case you are better off just doing the task directly.

## Task Fields

- **subject**: A brief, actionable title in imperative form (e.g., "Fix authentication bug in login flow")
- **description**: Detailed description of what needs to be done, including context and acceptance criteria
- **activeForm**: Present continuous form shown in spinner when task is in_progress (e.g., "Fixing authentication bug"). This is displayed to the user while you work on the task.

**IMPORTANT**: Always provide activeForm when creating tasks. The subject should be imperative ("Run tests") while activeForm should be present continuous ("Running tests"). All tasks are created with status `pending`.

## Tips

- Create tasks with clear, specific subjects that describe the outcome
- Include enough detail in the description for another agent to understand and complete the task
- After creating tasks, use TaskUpdate to set up dependencies (blocks/blockedBy) if needed
- Check TaskList first to avoid creating duplicate tasks
</textarea>
