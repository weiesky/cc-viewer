# ExitPlanMode

## Definition

Forlader planlægningstilstand og indsender planen til brugerens godkendelse. Planens indhold læses fra den tidligere skrevne planfil.

## Parametre

| Parameter | Type | Påkrævet | Beskrivelse |
|------|------|------|------|
| `allowedPrompts` | array | Nej | Liste over tilladelsebeskrivelser nødvendige for at implementere planen |

Hvert element i `allowedPrompts`-arrayet:

| Felt | Type | Påkrævet | Beskrivelse |
|------|------|------|------|
| `tool` | enum | Ja | Det gældende værktøj, understøtter i øjeblikket kun `Bash` |
| `prompt` | string | Ja | Semantisk beskrivelse af operationen (f.eks. "run tests", "install dependencies") |

## Brugsscenarier

**Egnet til:**
- I planlægningstilstand er planen færdig og klar til brugerens godkendelse
- Kun til implementeringsopgaver der kræver kodeskrivning

**Ikke egnet til:**
- Rene forsknings-/udforskningsopgaver — det er ikke nødvendigt at forlade planlægningstilstand
- At ville spørge brugeren "er planen OK?" — det er præcis dette værktøjs funktion, brug ikke AskUserQuestion til at spørge

## Bemærkninger

- Dette værktøj accepterer ikke planindhold som parameter — det læser fra den tidligere skrevne planfil
- Brugeren vil se planfilens indhold til godkendelse
- Brug ikke AskUserQuestion til at spørge "er planen OK?" før du kalder dette værktøj, det er overflødigt
- Nævn ikke "planen" i spørgsmål, da brugeren ikke kan se planindholdet før ExitPlanMode

## Betydning i cc-viewer

ExitPlanMode-kaldet markerer afslutningen af planlægningsfasen. I requestloggen skifter requests efter dette kald typisk til implementeringsoperationer (Edit, Write, Bash osv.).

## Originaltekst

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
