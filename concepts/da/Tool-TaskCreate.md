# TaskCreate

## Definition

Opretter en struktureret opgavelistepost til at spore fremskridt, organisere komplekse opgaver og vise brugeren arbejdets fremdrift.

## Parametre

| Parameter | Type | Påkrævet | Beskrivelse |
|------|------|------|------|
| `subject` | string | Ja | Kort opgavetitel i bydeform (f.eks. "Fix authentication bug") |
| `description` | string | Ja | Detaljeret beskrivelse inkl. kontekst og acceptkriterier |
| `activeForm` | string | Nej | Tekst i nutids-tillægsform vist under udførelse (f.eks. "Fixing authentication bug") |
| `metadata` | object | Nej | Vilkårlig metadata knyttet til opgaven |

## Brugsscenarier

**Egnet til:**
- Komplekse flertrinsopgaver (mere end 3 trin)
- Brugeren har givet flere gøremål
- Sporing af arbejde i planlægningstilstand
- Brugeren beder udtrykkeligt om en todo-liste

**Ikke egnet til:**
- En enkelt simpel opgave
- Simple operationer med færre end 3 trin
- Ren samtale eller informationsforespørgsler

## Bemærkninger

- Alle nyoprettede opgaver har startstatus `pending`
- `subject` bruger bydeform ("Run tests"), `activeForm` bruger nutids-tillægsform ("Running tests")
- Efter oprettelse kan afhængigheder (blocks/blockedBy) sættes via TaskUpdate
- Før oprettelse bør man tjekke med TaskList, om der findes duplikerede opgaver

## Betydning i cc-viewer

TaskCreate er en intern opgavestyringsoperation i Claude Code og genererer ikke selvstændige API-requests. Men i Chat Mode kan man se det tool_use-block, hvor modellen kalder dette værktøj.

## Originaltekst

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
