# TaskGet

## Definicja

Pobiera pełne szczegóły zadania na podstawie jego ID.

## Parametry

| Parametr | Typ | Wymagany | Opis |
|------|------|------|------|
| `taskId` | string | Tak | ID zadania do pobrania |

## Zwracana zawartość

- `subject` — tytuł zadania
- `description` — szczegółowe wymagania i kontekst
- `status` — status: `pending`, `in_progress` lub `completed`
- `blocks` — lista zadań zablokowanych przez to zadanie
- `blockedBy` — lista zadań poprzedzających, które blokują to zadanie

## Scenariusze użycia

**Odpowiednie zastosowanie:**
- Pobranie pełnego opisu i kontekstu zadania przed rozpoczęciem pracy
- Zrozumienie zależności zadania
- Pobranie pełnych wymagań po przydzieleniu zadania

## Uwagi

- Po pobraniu zadania należy sprawdzić, czy lista `blockedBy` jest pusta, zanim rozpocznie się pracę
- Użyj TaskList, aby zobaczyć podsumowanie wszystkich zadań

## Znaczenie w cc-viewer

TaskGet to wewnętrzna operacja zarządzania zadaniami, nie generuje niezależnego żądania API.

## Tekst oryginalny

<textarea readonly>Use this tool to retrieve a task by its ID from the task list.

## When to Use This Tool

- When you need the full description and context before starting work on a task
- To understand task dependencies (what it blocks, what blocks it)
- After being assigned a task, to get complete requirements

## Output

Returns full task details:
- **subject**: Task title
- **description**: Detailed requirements and context
- **status**: 'pending', 'in_progress', or 'completed'
- **blocks**: Tasks waiting on this one to complete
- **blockedBy**: Tasks that must complete before this one can start

## Tips

- After fetching a task, verify its blockedBy list is empty before beginning work.
- Use TaskList to see all tasks in summary form.
</textarea>
