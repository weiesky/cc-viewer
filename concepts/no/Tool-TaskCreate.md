# TaskCreate

## Definisjon

Oppretter strukturerte oppgavelisteelementer for å spore fremdrift, organisere komplekse oppgaver og vise arbeidsfremdrift til brukeren.

## Parametere

| Parameter | Type | Påkrevd | Beskrivelse |
|-----------|------|---------|-------------|
| `subject` | string | Ja | Kort oppgavetittel i imperativform (f.eks. "Fix authentication bug") |
| `description` | string | Ja | Detaljert beskrivelse med kontekst og akseptansekriterier |
| `activeForm` | string | Nei | Tekst i presens partisipp som vises under utførelse (f.eks. "Fixing authentication bug") |
| `metadata` | object | Nei | Vilkårlig metadata knyttet til oppgaven |

## Bruksscenarioer

**Egnet for bruk:**
- Komplekse flerstegsoppgaver (mer enn 3 steg)
- Brukeren har gitt flere gjøremål
- Spore arbeid i planleggingsmodus
- Brukeren ber eksplisitt om å bruke oppgaveliste

**Ikke egnet for bruk:**
- Enkelt, enkel oppgave
- Enkle operasjoner med 3 steg eller færre
- Ren samtale eller informasjonsforespørsel

## Merknader

- Alle nye oppgaver starter med status `pending`
- `subject` bruker imperativform ("Run tests"), `activeForm` bruker presens partisipp ("Running tests")
- Etter opprettelse kan avhengigheter (blocks/blockedBy) settes via TaskUpdate
- Før opprettelse bør TaskList kalles for å sjekke om det finnes duplikater

## Betydning i cc-viewer

TaskCreate er en intern oppgavebehandlingsoperasjon i Claude Code og produserer ikke en selvstendig API-forespørsel. Men i Chat Mode kan du se tool_use-blokken der modellen kaller dette verktøyet.

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
