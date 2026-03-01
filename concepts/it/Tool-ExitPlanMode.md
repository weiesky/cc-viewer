# ExitPlanMode

## Definizione

Esce dalla modalità pianificazione e sottopone il piano all'approvazione dell'utente. Il contenuto del piano viene letto dal file di piano scritto in precedenza.

## Parametri

| Parametro | Tipo | Obbligatorio | Descrizione |
|------|------|------|------|
| `allowedPrompts` | array | No | Lista di descrizioni dei permessi necessari per implementare il piano |

Ogni elemento nell'array `allowedPrompts`:

| Campo | Tipo | Obbligatorio | Descrizione |
|------|------|------|------|
| `tool` | enum | Sì | Lo strumento applicabile, attualmente supporta solo `Bash` |
| `prompt` | string | Sì | Descrizione semantica dell'operazione (es. "run tests", "install dependencies") |

## Scenari d'uso

**Adatto per:**
- In modalità pianificazione, il piano è completato e pronto per l'approvazione dell'utente
- Solo per task di implementazione che richiedono la scrittura di codice

**Non adatto per:**
- Task puramente di ricerca/esplorazione — non è necessario uscire dalla modalità pianificazione
- Voler chiedere all'utente "il piano va bene?" — questa è esattamente la funzione di questo strumento, non usare AskUserQuestion per chiederlo

## Note

- Questo strumento non accetta il contenuto del piano come parametro — lo legge dal file di piano scritto in precedenza
- L'utente vedrà il contenuto del file di piano per l'approvazione
- Non usare AskUserQuestion per chiedere "il piano va bene?" prima di chiamare questo strumento, sarebbe ridondante
- Non menzionare il "piano" nelle domande, poiché l'utente non può vedere il contenuto del piano prima di ExitPlanMode

## Significato in cc-viewer

La chiamata ExitPlanMode segna la fine della fase di pianificazione. Nei log delle richieste, le richieste successive a questa chiamata passano tipicamente a operazioni di implementazione (Edit, Write, Bash, ecc.).

## Testo originale

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
