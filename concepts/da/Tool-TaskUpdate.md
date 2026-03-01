# TaskUpdate

## Definition

Opdaterer status, indhold eller afhængigheder for en opgave i opgavelisten.

## Parametre

| Parameter | Type | Påkrævet | Beskrivelse |
|------|------|------|------|
| `taskId` | string | Ja | ID på opgaven der skal opdateres |
| `status` | enum | Nej | Ny status: `pending` / `in_progress` / `completed` / `deleted` |
| `subject` | string | Nej | Ny titel |
| `description` | string | Nej | Ny beskrivelse |
| `activeForm` | string | Nej | Tekst i nutids-tillægsform vist under udførelse |
| `owner` | string | Nej | Ny opgaveansvarlig (agent-navn) |
| `metadata` | object | Nej | Metadata der skal flettes (sæt til null for at slette en nøgle) |
| `addBlocks` | string[] | Nej | Liste over ID'er for opgaver blokeret af denne opgave |
| `addBlockedBy` | string[] | Nej | Liste over ID'er for forudgående opgaver der blokerer denne opgave |

## Statusflow

```
pending → in_progress → completed
```

`deleted` kan nås fra enhver status og fjerner opgaven permanent.

## Brugsscenarier

**Egnet til:**
- Markere en opgave som `in_progress` når arbejdet påbegyndes
- Markere en opgave som `completed` når arbejdet er afsluttet
- Sætte afhængigheder mellem opgaver
- Opdatere opgaveindhold når kravene ændres

**Vigtige regler:**
- Markér kun som `completed` når opgaven er fuldstændigt afsluttet
- Ved fejl eller blokeringer, behold `in_progress`
- Markér ikke som `completed` ved fejlende tests, ufuldstændig implementering eller uløste fejl

## Bemærkninger

- Før opdatering bør man hente opgavens seneste status via TaskGet for at undgå forældede data
- Efter fuldførelse af en opgave, kald TaskList for at finde den næste tilgængelige opgave

## Betydning i cc-viewer

TaskUpdate er en intern opgavestyringsoperation og genererer ikke selvstændige API-requests.

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
