# TaskUpdate

## Definizione

Aggiorna lo stato, il contenuto o le dipendenze di un task nella lista dei task.

## Parametri

| Parametro | Tipo | Obbligatorio | Descrizione |
|------|------|------|------|
| `taskId` | string | Sì | ID del task da aggiornare |
| `status` | enum | No | Nuovo stato: `pending` / `in_progress` / `completed` / `deleted` |
| `subject` | string | No | Nuovo titolo |
| `description` | string | No | Nuova descrizione |
| `activeForm` | string | No | Testo al presente progressivo mostrato durante l'esecuzione |
| `owner` | string | No | Nuovo responsabile del task (nome dell'agent) |
| `metadata` | object | No | Metadati da unire (impostare a null per eliminare una chiave) |
| `addBlocks` | string[] | No | Lista degli ID dei task bloccati da questo task |
| `addBlockedBy` | string[] | No | Lista degli ID dei task prerequisiti che bloccano questo task |

## Flusso degli stati

```
pending → in_progress → completed
```

`deleted` può essere raggiunto da qualsiasi stato e rimuove permanentemente il task.

## Scenari d'uso

**Adatto per:**
- Contrassegnare un task come `in_progress` quando si inizia il lavoro
- Contrassegnare un task come `completed` quando il lavoro è terminato
- Impostare le dipendenze tra i task
- Aggiornare il contenuto del task quando i requisiti cambiano

**Regole importanti:**
- Contrassegnare come `completed` solo quando il task è completamente terminato
- In caso di errori o blocchi, mantenere `in_progress`
- Non contrassegnare come `completed` in caso di test falliti, implementazione incompleta o errori non risolti

## Note

- Prima dell'aggiornamento, ottenere lo stato più recente del task tramite TaskGet per evitare dati obsoleti
- Dopo aver completato un task, chiamare TaskList per trovare il prossimo task disponibile

## Significato in cc-viewer

TaskUpdate è un'operazione interna di gestione dei task, non genera richieste API indipendenti.

## Testo originale

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
