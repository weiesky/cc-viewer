# TaskCreate

## Definition

Creates a structured task list entry for tracking progress, organizing complex tasks, and demonstrating work progress to the user.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `subject` | string | Yes | Short task title in imperative form (e.g., "Fix authentication bug") |
| `description` | string | Yes | Detailed description including context and acceptance criteria |
| `activeForm` | string | No | Present continuous text displayed when in progress (e.g., "Fixing authentication bug") |
| `metadata` | object | No | Arbitrary metadata attached to the task |

## Use Cases

**Good for:**
- Complex multi-step tasks (more than 3 steps)
- When the user provides multiple to-do items
- Tracking work in plan mode
- When the user explicitly requests a todo list

**Not good for:**
- A single simple task
- Simple operations with 3 or fewer steps
- Pure conversation or information queries

## Notes

- All newly created tasks have an initial status of `pending`
- `subject` uses imperative form ("Run tests"), `activeForm` uses present continuous ("Running tests")
- After creating a task, use TaskUpdate to set dependencies (blocks/blockedBy)
- Before creating, call TaskList first to check for duplicate tasks

## Significance in cc-viewer

TaskCreate is an internal task management operation in Claude Code and does not produce independent API requests. However, the model's tool_use block for calling this tool can be seen in Chat Mode.

## Original Text

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
