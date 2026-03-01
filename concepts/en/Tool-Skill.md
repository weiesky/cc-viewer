# Skill

## Definition

Executes a skill within the main conversation. Skills are specialized capabilities that users can invoke via slash commands (e.g., `/commit`, `/review-pr`).

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `skill` | string | Yes | Skill name (e.g., "commit", "review-pr", "pdf") |
| `args` | string | No | Skill arguments |

## Use Cases

**Good for:**
- When the user enters a slash command in the `/<skill-name>` format
- When the user's request matches the functionality of a registered skill

**Not good for:**
- Built-in CLI commands (e.g., `/help`, `/clear`)
- A skill that is already running
- Skill names not in the available skills list

## Notes

- Once invoked, the skill expands into a full prompt
- Supports fully qualified names (e.g., `ms-office-suite:pdf`)
- The available skills list is provided in system-reminder messages
- When you see a `<command-name>` tag, it means the skill is already loaded — execute it directly rather than calling this tool again
- Do not mention a skill without actually calling the tool

## Significance in cc-viewer

Skill calls appear in request logs as `tool_use` content blocks. The prompt expanded from the skill affects the system prompt or message content of subsequent requests.

## Original Text

<textarea readonly>Execute a skill within the main conversation

When users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.

When users reference a "slash command" or "/<something>" (e.g., "/commit", "/review-pr"), they are referring to a skill. Use this tool to invoke it.

How to invoke:
- Use this tool with the skill name and optional arguments
- Examples:
  - `skill: "pdf"` - invoke the pdf skill
  - `skill: "commit", args: "-m 'Fix bug'"` - invoke with arguments
  - `skill: "review-pr", args: "123"` - invoke with arguments
  - `skill: "ms-office-suite:pdf"` - invoke using fully qualified name

Important:
- Available skills are listed in system-reminder messages in the conversation
- When a skill matches the user's request, this is a BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response about the task
- NEVER mention a skill without actually calling this tool
- Do not invoke a skill that is already running
- Do not use this tool for built-in CLI commands (like /help, /clear, etc.)
- If you see a <command-name> tag in the current conversation turn, the skill has ALREADY been loaded - follow the instructions directly instead of calling this tool again
</textarea>
