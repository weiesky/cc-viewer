# TaskList

## Definicja

Wyświetla listę wszystkich zadań na liście zadań, umożliwiając przegląd ogólnego postępu i dostępnej pracy.

## Parametry

Brak parametrów.

## Zwracana zawartość

Podsumowanie każdego zadania:
- `id` — identyfikator zadania
- `subject` — krótki opis
- `status` — status: `pending`, `in_progress` lub `completed`
- `owner` — odpowiedzialny (ID agenta), puste oznacza nieprzydzielone
- `blockedBy` — lista ID nieukończonych zadań blokujących to zadanie

## Scenariusze użycia

**Odpowiednie zastosowanie:**
- Sprawdzanie dostępnych zadań (status pending, brak owner, niezablokowane)
- Sprawdzanie ogólnego postępu projektu
- Wyszukiwanie zablokowanych zadań
- Wyszukiwanie następnego zadania po ukończeniu bieżącego

## Uwagi

- Preferuj przetwarzanie zadań w kolejności ID (najniższe ID najpierw), ponieważ wcześniejsze zadania zazwyczaj dostarczają kontekst dla późniejszych
- Zadania z `blockedBy` nie mogą być podjęte przed usunięciem zależności
- Użyj TaskGet, aby uzyskać pełne szczegóły konkretnego zadania

## Znaczenie w cc-viewer

TaskList to wewnętrzna operacja zarządzania zadaniami, nie generuje niezależnego żądania API.

## Tekst oryginalny

<textarea readonly>Use this tool to list all tasks in the task list.

## When to Use This Tool

- To see what tasks are available to work on (status: 'pending', no owner, not blocked)
- To check overall progress on the project
- To find tasks that are blocked and need dependencies resolved
- After completing a task, to check for newly unblocked work or claim the next available task
- **Prefer working on tasks in ID order** (lowest ID first) when multiple tasks are available, as earlier tasks often set up context for later ones

## Output

Returns a summary of each task:
- **id**: Task identifier (use with TaskGet, TaskUpdate)
- **subject**: Brief description of the task
- **status**: 'pending', 'in_progress', or 'completed'
- **owner**: Agent ID if assigned, empty if available
- **blockedBy**: List of open task IDs that must be resolved first (tasks with blockedBy cannot be claimed until dependencies resolve)

Use TaskGet with a specific task ID to view full details including description and comments.
</textarea>
