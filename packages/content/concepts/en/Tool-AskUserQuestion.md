# AskUserQuestion

Presents the user with one or more structured multiple-choice questions inside the chat UI, collects their selections, and returns them to the assistant — useful for disambiguating intent without a free-form back-and-forth.

## When to Use

- A request has multiple reasonable interpretations and the assistant needs the user to pick one before proceeding.
- The user must choose among concrete options (framework, library, file path, strategy) where free-text replies would be error-prone.
- You want to compare alternatives side by side using the preview pane.
- Several related decisions can be batched into a single prompt to reduce back-and-forth.
- A plan or tool call depends on configuration the user has not yet specified.

## Parameters

- `questions` (array, required): One to four questions shown together in a single prompt. Each question object contains:
  - `question` (string, required): The full question text, ending with a question mark.
  - `header` (string, required): A short label (at most 12 characters) rendered as a chip above the question.
  - `options` (array, required): Two to four option objects. Each option has a `label` (1–5 words), a `description`, and an optional `markdown` preview.
  - `multiSelect` (boolean, required): When `true`, the user may pick more than one option.

## Examples

### Example 1: Pick a single framework

```
AskUserQuestion(questions=[{
  "header": "Test runner",
  "question": "Which test runner should I configure?",
  "multiSelect": false,
  "options": [
    {"label": "Vitest (Recommended)", "description": "Fast, Vite-native, Jest-compatible API"},
    {"label": "Jest",                  "description": "Mature, broadest plugin ecosystem"},
    {"label": "Node --test",           "description": "Zero dependencies, built in"}
  ]
}])
```

### Example 2: Side-by-side preview of two layouts

```
AskUserQuestion(questions=[{
  "header": "Layout",
  "question": "Which dashboard layout do you prefer?",
  "multiSelect": false,
  "options": [
    {"label": "Sidebar",  "description": "Nav on the left", "markdown": "```\n+------+---------+\n| NAV  | CONTENT |\n+------+---------+\n```"},
    {"label": "Top bar",  "description": "Nav across top",  "markdown": "```\n+-----------------+\n|       NAV       |\n+-----------------+\n|     CONTENT     |\n+-----------------+\n```"}
  ]
}])
```

## Notes

- The UI automatically appends an "Other" free-text option to every question. Do not add your own "Other", "None", or "Custom" entry — it will duplicate the built-in escape hatch.
- Limit each call to between one and four questions and each question to between two and four options. Exceeding these bounds is rejected by the harness.
- If you recommend a specific option, put it first and append "(Recommended)" to its label so the UI highlights the preferred path.
- Previews via the `markdown` field are only supported on single-select questions. Use them for visual artifacts such as ASCII layouts, code snippets, or configuration diffs — not for simple preference questions where a label plus description suffice.
- When any option in a question has a `markdown` value, the UI switches to a side-by-side layout with the option list on the left and the preview on the right.
- Do not use `AskUserQuestion` to ask "does this plan look good?" — call `ExitPlanMode` instead, which exists precisely for plan approval. In plan mode, also avoid mentioning "the plan" in question text, because the plan is not visible to the user until `ExitPlanMode` runs.
- Do not use this tool to request sensitive or free-form input such as API keys or passwords. Ask in chat instead.
