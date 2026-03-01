# TaskCreate

## 定義

構造化されたタスクリストエントリを作成し、進捗の追跡、複雑なタスクの整理、ユーザーへの作業進捗の表示に使用します。

## パラメータ

| パラメータ | 型 | 必須 | 説明 |
|------------|------|------|------|
| `subject` | string | はい | 短いタスクタイトル、命令形を使用（例："Fix authentication bug"） |
| `description` | string | はい | 詳細な説明、コンテキストと受け入れ基準を含む |
| `activeForm` | string | いいえ | 進行中に表示する現在進行形テキスト（例："Fixing authentication bug"） |
| `metadata` | object | いいえ | タスクに付加する任意のメタデータ |

## 使用シナリオ

**適している場合：**
- 複雑なマルチステップタスク（3ステップ以上）
- ユーザーが複数の TODO 項目を提供した
- 計画モードで作業を追跡
- ユーザーが明示的に todo リストの使用を要求

**適していない場合：**
- 単一の簡単なタスク
- 3ステップ以内の簡単な操作
- 純粋な会話や情報照会

## 注意事項

- すべての新規タスクの初期ステータスは `pending`
- `subject` は命令形（"Run tests"）、`activeForm` は現在進行形（"Running tests"）を使用
- 作成後に TaskUpdate で依存関係（blocks/blockedBy）を設定可能
- 作成前に TaskList を呼び出して重複タスクがないか確認すべき

## cc-viewer での意義

TaskCreate は Claude Code 内部のタスク管理操作であり、独立した API リクエストは生成しません。ただし Chat Mode ではモデルがこのツールを呼び出した tool_use block を確認できます。

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
