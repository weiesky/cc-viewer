# AskUserQuestion

## Definition

Asks the user a question during execution to obtain clarification, validate assumptions, or request decisions.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `questions` | array | Yes | List of questions (1-4 questions) |
| `answers` | object | No | Answers collected from the user |
| `annotations` | object | No | Annotations for each question (e.g., notes for preview selections) |
| `metadata` | object | No | Metadata for tracking and analysis |

Each `question` object:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `question` | string | Yes | Full question text, should end with a question mark |
| `header` | string | Yes | Short label (max 12 characters), displayed as a tag chip |
| `options` | array | Yes | 2-4 options |
| `multiSelect` | boolean | Yes | Whether multiple selections are allowed |

Each `option` object:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `label` | string | Yes | Option display text (1-5 words) |
| `description` | string | Yes | Option description |
| `markdown` | string | No | Preview content (for visual comparison of ASCII layouts, code snippets, etc.) |

## Use Cases

**Good for:**
- Collecting user preferences or requirements
- Clarifying ambiguous instructions
- Getting decisions during implementation
- Providing directional choices to the user

**Not good for:**
- Asking "Is the plan okay?" — use ExitPlanMode instead

## Notes

- The user can always choose "Other" to provide custom input
- Place the recommended option first and append "(Recommended)" to its label
- `markdown` preview is only supported for single-select questions
- Options with `markdown` switch to a side-by-side layout
- In plan mode, used to clarify requirements before finalizing the plan

## Significance in cc-viewer

AskUserQuestion calls appear in request logs as `tool_use` content blocks containing the question and option definitions. The user's answers appear in the message history of subsequent requests.

## Original Text

<textarea readonly>Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- Users will always be able to select "Other" to provide custom text input
- Use multiSelect: true to allow multiple answers to be selected for a question
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label

Plan mode note: In plan mode, use this tool to clarify requirements or choose between approaches BEFORE finalizing your plan. Do NOT use this tool to ask "Is my plan ready?" or "Should I proceed?" - use ExitPlanMode for plan approval. IMPORTANT: Do not reference "the plan" in your questions (e.g., "Do you have feedback about the plan?", "Does the plan look good?") because the user cannot see the plan in the UI until you call ExitPlanMode. If you need plan approval, use ExitPlanMode instead.

Preview feature:
Use the optional `markdown` field on options when presenting concrete artifacts that users need to visually compare:
- ASCII mockups of UI layouts or components
- Code snippets showing different implementations
- Diagram variations
- Configuration examples

When any option has a markdown, the UI switches to a side-by-side layout with a vertical option list on the left and preview on the right. Do not use previews for simple preference questions where labels and descriptions suffice. Note: previews are only supported for single-select questions (not multiSelect).
</textarea>
