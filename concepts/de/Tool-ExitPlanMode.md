# ExitPlanMode

## Definition

Verlässt den Planungsmodus und reicht den Plan zur Benutzerfreigabe ein. Der Planinhalt wird aus der zuvor geschriebenen Plandatei gelesen.

## Parameter

| Parameter | Typ | Erforderlich | Beschreibung |
|-----------|-----|--------------|--------------|
| `allowedPrompts` | array | Nein | Liste der für die Planumsetzung benötigten Berechtigungsbeschreibungen |

Jedes Element im `allowedPrompts`-Array:

| Feld | Typ | Erforderlich | Beschreibung |
|------|-----|--------------|--------------|
| `tool` | enum | Ja | Das zutreffende Tool, derzeit nur `Bash` unterstützt |
| `prompt` | string | Ja | Semantische Beschreibung der Operation (z.B. "run tests", "install dependencies") |

## Anwendungsfälle

**Geeignet für:**
- Der Plan im Planungsmodus ist fertig und bereit zur Benutzerfreigabe
- Nur für Implementierungsaufgaben, die Code schreiben erfordern

**Nicht geeignet für:**
- Reine Recherche-/Erkundungsaufgaben – kein Verlassen des Planungsmodus nötig
- Den Benutzer fragen „Ist der Plan in Ordnung?" – genau das ist die Funktion dieses Tools, verwenden Sie nicht AskUserQuestion dafür

## Hinweise

- Dieses Tool akzeptiert keinen Planinhalt als Parameter – es liest aus der zuvor geschriebenen Plandatei
- Der Benutzer sieht den Inhalt der Plandatei zur Genehmigung
- Verwenden Sie nicht AskUserQuestion vor dem Aufruf dieses Tools, um zu fragen „Ist der Plan in Ordnung?" – das wäre redundant
- Erwähnen Sie den „Plan" nicht in Fragen, da der Benutzer den Planinhalt vor ExitPlanMode nicht sehen kann

## Bedeutung in cc-viewer

Der ExitPlanMode-Aufruf markiert das Ende der Planungsphase. Im Anfrage-Log wechseln die Anfragen nach diesem Aufruf typischerweise zu Implementierungsoperationen (Edit, Write, Bash usw.).

## Originaltext

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
