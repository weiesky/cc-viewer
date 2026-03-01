# TaskUpdate

## Definition

Aktualisiert den Status, Inhalt oder die Abhängigkeiten einer Aufgabe in der Aufgabenliste.

## Parameter

| Parameter | Typ | Erforderlich | Beschreibung |
|-----------|-----|--------------|--------------|
| `taskId` | string | Ja | Die zu aktualisierende Aufgaben-ID |
| `status` | enum | Nein | Neuer Status: `pending` / `in_progress` / `completed` / `deleted` |
| `subject` | string | Nein | Neuer Titel |
| `description` | string | Nein | Neue Beschreibung |
| `activeForm` | string | Nein | Text in Verlaufsform, der während der Bearbeitung angezeigt wird |
| `owner` | string | Nein | Neuer Aufgabenverantwortlicher (Agent-Name) |
| `metadata` | object | Nein | Zu mergende Metadaten (auf null setzen zum Löschen eines Schlüssels) |
| `addBlocks` | string[] | Nein | Liste der Aufgaben-IDs, die von dieser Aufgabe blockiert werden |
| `addBlockedBy` | string[] | Nein | Liste der Voraussetzungsaufgaben-IDs, die diese Aufgabe blockieren |

## Status-Workflow

```
pending → in_progress → completed
```

`deleted` kann von jedem Status aus gesetzt werden und entfernt die Aufgabe dauerhaft.

## Anwendungsfälle

**Geeignet für:**
- Aufgabe bei Arbeitsbeginn als `in_progress` markieren
- Aufgabe nach Abschluss als `completed` markieren
- Abhängigkeiten zwischen Aufgaben festlegen
- Aufgabeninhalt bei Anforderungsänderungen aktualisieren

**Wichtige Regeln:**
- Nur als `completed` markieren, wenn die Aufgabe vollständig abgeschlossen ist
- Bei Fehlern oder Blockaden den Status `in_progress` beibehalten
- Nicht als `completed` markieren bei: fehlgeschlagenen Tests, unvollständiger Implementierung, ungelösten Fehlern

## Hinweise

- Vor der Aktualisierung den aktuellen Status über TaskGet abrufen, um veraltete Daten zu vermeiden
- Nach Abschluss einer Aufgabe TaskList aufrufen, um die nächste verfügbare Aufgabe zu finden

## Bedeutung in cc-viewer

TaskUpdate ist eine interne Aufgabenverwaltungsoperation und erzeugt keine eigenständige API-Anfrage.

## Originaltext

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
