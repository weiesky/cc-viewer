# TaskUpdate

## Definisjon

Oppdaterer status, innhold eller avhengighetsforhold for en oppgave i oppgavelisten.

## Parametere

| Parameter | Type | Påkrevd | Beskrivelse |
|-----------|------|---------|-------------|
| `taskId` | string | Ja | ID-en til oppgaven som skal oppdateres |
| `status` | enum | Nei | Ny status: `pending` / `in_progress` / `completed` / `deleted` |
| `subject` | string | Nei | Ny tittel |
| `description` | string | Nei | Ny beskrivelse |
| `activeForm` | string | Nei | Tekst i presens partisipp som vises under utførelse |
| `owner` | string | Nei | Ny oppgaveansvarlig (agent-navn) |
| `metadata` | object | Nei | Metadata som skal flettes inn (sett til null for å slette nøkkel) |
| `addBlocks` | string[] | Nei | Liste over oppgave-ID-er blokkert av denne oppgaven |
| `addBlockedBy` | string[] | Nei | Liste over forutgående oppgave-ID-er som blokkerer denne oppgaven |

## Statusflyt

```
pending → in_progress → completed
```

`deleted` kan nås fra enhver status og fjerner oppgaven permanent.

## Bruksscenarioer

**Egnet for bruk:**
- Markere oppgave som `in_progress` når arbeidet starter
- Markere oppgave som `completed` etter fullført arbeid
- Sette avhengighetsforhold mellom oppgaver
- Oppdatere oppgaveinnhold ved endrede krav

**Viktige regler:**
- Marker kun som `completed` når oppgaven er fullstendig ferdig
- Ved feil eller blokkering, behold `in_progress`
- Ikke marker som `completed` ved mislykkede tester, ufullstendig implementering eller uløste feil

## Merknader

- Før oppdatering bør du hente siste oppgavestatus via TaskGet for å unngå utdaterte data
- Etter fullføring av oppgave, kall TaskList for å finne neste tilgjengelige oppgave

## Betydning i cc-viewer

TaskUpdate er en intern oppgavebehandlingsoperasjon og produserer ikke en selvstendig API-forespørsel.

## Originaltekst

<textarea readonly>Use this tool to update a task in the task list.

## When to Use This Tool

**Mark tasks as resolved:**
- When you have completed the work described in a task
- When a task is no longer needed or has been superseded
- IMPORTANT: Always mark your assigned tasks as resolved when you finish them
- After resolving, call TaskList to find your next task

- ONLY mark a task as completed when you have FULLY accomplished it
- If you encounter errors, blockers, or cannot finish, keep the task as in_progress
- When blocked, create a new task describing what needs to be resolved
- Never mark a task as completed if:
  - Tests are failing
  - Implementation is partial
  - You encountered unresolved errors
  - You couldn't find necessary files or dependencies

**Delete tasks:**
- When a task is no longer relevant or was created in error
- Setting status to `deleted` permanently removes the task

**Update task details:**
- When requirements change or become clearer
- When establishing dependencies between tasks

## Fields You Can Update

- **status**: The task status (see Status Workflow below)
- **subject**: Change the task title (imperative form, e.g., "Run tests")
- **description**: Change the task description
- **activeForm**: Present continuous form shown in spinner when in_progress (e.g., "Running tests")
- **owner**: Change the task owner (agent name)
- **metadata**: Merge metadata keys into the task (set a key to null to delete it)
- **addBlocks**: Mark tasks that cannot start until this one completes
- **addBlockedBy**: Mark tasks that must complete before this one can start

## Status Workflow

Status progresses: `pending` → `in_progress` → `completed`

Use `deleted` to permanently remove a task.

## Staleness

Make sure to read a task's latest state using `TaskGet` before updating it.

## Examples

Mark task as in progress when starting work:
```json
{"taskId": "1", "status": "in_progress"}
```

Mark task as completed after finishing work:
```json
{"taskId": "1", "status": "completed"}
```

Delete a task:
```json
{"taskId": "1", "status": "deleted"}
```

Claim a task by setting owner:
```json
{"taskId": "1", "owner": "my-name"}
```

Set up task dependencies:
```json
{"taskId": "2", "addBlockedBy": ["1"]}
```
</textarea>
