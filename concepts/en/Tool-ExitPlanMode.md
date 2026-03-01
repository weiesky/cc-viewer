# ExitPlanMode

## Definition

Exits plan mode and submits the plan for user approval. The plan content is read from a previously written plan file.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `allowedPrompts` | array | No | List of permission descriptions required for the implementation plan |

Each element in the `allowedPrompts` array:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tool` | enum | Yes | The applicable tool, currently only supports `Bash` |
| `prompt` | string | Yes | Semantic description of the operation (e.g., "run tests", "install dependencies") |

## Use Cases

**Good for:**
- The plan is complete in plan mode and ready for user approval
- Only for implementation tasks that require writing code

**Not good for:**
- Pure research/exploration tasks — no need to exit plan mode
- Asking the user "Is the plan okay?" — that is exactly what this tool does, do not use AskUserQuestion for that

## Notes

- This tool does not accept plan content as a parameter — it reads from a previously written plan file
- The user will see the plan file content for approval
- Do not use AskUserQuestion to ask "Is the plan okay?" before calling this tool, as that would be redundant
- Do not mention "the plan" in questions, since the user cannot see the plan content before ExitPlanMode

## Significance in cc-viewer

ExitPlanMode calls mark the end of the planning phase. In request logs, requests after this call typically shift to implementation operations (Edit, Write, Bash, etc.).

## Original Text

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
