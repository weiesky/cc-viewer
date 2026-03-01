# TaskCreate

## Definizione

Crea una voce strutturata nella lista dei task, per tracciare i progressi, organizzare task complessi e mostrare all'utente l'avanzamento del lavoro.

## Parametri

| Parametro | Tipo | Obbligatorio | Descrizione |
|------|------|------|------|
| `subject` | string | Sì | Breve titolo del task, in forma imperativa (es. "Fix authentication bug") |
| `description` | string | Sì | Descrizione dettagliata, inclusi contesto e criteri di accettazione |
| `activeForm` | string | No | Testo al presente progressivo mostrato durante l'esecuzione (es. "Fixing authentication bug") |
| `metadata` | object | No | Metadati arbitrari allegati al task |

## Scenari d'uso

**Adatto per:**
- Task complessi multi-step (più di 3 step)
- L'utente ha fornito più elementi da fare
- Tracciamento del lavoro in modalità pianificazione
- L'utente richiede esplicitamente l'uso di una lista todo

**Non adatto per:**
- Un singolo task semplice
- Operazioni semplici con meno di 3 step
- Conversazioni pure o richieste informative

## Note

- Tutti i task appena creati hanno stato iniziale `pending`
- `subject` usa la forma imperativa ("Run tests"), `activeForm` usa il presente progressivo ("Running tests")
- Dopo la creazione, è possibile impostare le dipendenze (blocks/blockedBy) tramite TaskUpdate
- Prima di creare, verificare con TaskList se esistono task duplicati

## Significato in cc-viewer

TaskCreate è un'operazione interna di gestione dei task di Claude Code, non genera richieste API indipendenti. Tuttavia, nella Chat Mode è possibile vedere il content block tool_use in cui il modello invoca questo strumento.

## Testo originale

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
