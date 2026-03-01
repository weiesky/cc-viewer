# TaskUpdate

## Definicja

Aktualizuje status, zawartość lub zależności zadania na liście zadań.

## Parametry

| Parametr | Typ | Wymagany | Opis |
|------|------|------|------|
| `taskId` | string | Tak | ID zadania do aktualizacji |
| `status` | enum | Nie | Nowy status: `pending` / `in_progress` / `completed` / `deleted` |
| `subject` | string | Nie | Nowy tytuł |
| `description` | string | Nie | Nowy opis |
| `activeForm` | string | Nie | Tekst w czasie teraźniejszym ciągłym wyświetlany podczas wykonywania |
| `owner` | string | Nie | Nowy odpowiedzialny za zadanie (nazwa agenta) |
| `metadata` | object | Nie | Metadane do scalenia (ustawienie na null usuwa klucz) |
| `addBlocks` | string[] | Nie | Lista ID zadań zablokowanych przez to zadanie |
| `addBlockedBy` | string[] | Nie | Lista ID zadań poprzedzających, które blokują to zadanie |

## Przepływ statusów

```
pending → in_progress → completed
```

`deleted` może być ustawiony z dowolnego statusu, trwale usuwa zadanie.

## Scenariusze użycia

**Odpowiednie zastosowanie:**
- Oznaczanie zadania jako `in_progress` przy rozpoczęciu pracy
- Oznaczanie zadania jako `completed` po zakończeniu pracy
- Ustawianie zależności między zadaniami
- Aktualizacja zawartości zadania przy zmianie wymagań

**Ważne zasady:**
- Oznaczaj jako `completed` tylko po pełnym ukończeniu zadania
- W przypadku błędów lub blokad zachowaj status `in_progress`
- Nie oznaczaj jako `completed` gdy testy nie przechodzą, implementacja jest niepełna lub wystąpiły nierozwiązane błędy

## Uwagi

- Przed aktualizacją należy pobrać najnowszy stan zadania przez TaskGet, aby uniknąć przestarzałych danych
- Po ukończeniu zadania wywołaj TaskList, aby znaleźć następne dostępne zadanie

## Znaczenie w cc-viewer

TaskUpdate to wewnętrzna operacja zarządzania zadaniami, nie generuje niezależnego żądania API.

## Tekst oryginalny

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
