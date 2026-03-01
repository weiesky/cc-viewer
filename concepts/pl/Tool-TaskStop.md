# TaskStop

## Definicja

Zatrzymuje działające zadanie w tle.

## Parametry

| Parametr | Typ | Wymagany | Opis |
|------|------|------|------|
| `task_id` | string | Nie | ID zadania w tle do zatrzymania |
| `shell_id` | string | Nie | Przestarzały, użyj `task_id` zamiast tego |

## Scenariusze użycia

**Odpowiednie zastosowanie:**
- Zakończenie długo działającego zadania, które nie jest już potrzebne
- Anulowanie błędnie uruchomionego zadania w tle

## Uwagi

- Zwraca status powodzenia lub niepowodzenia
- Parametr `shell_id` jest przestarzały, należy używać `task_id`

## Znaczenie w cc-viewer

Wywołanie TaskStop samo w sobie nie generuje żądania API — jest to wewnętrzna operacja zarządzania zadaniami Claude Code.

## Tekst oryginalny

<textarea readonly>
- Stops a running background task by its ID
- Takes a task_id parameter identifying the task to stop
- Returns a success or failure status
- Use this tool when you need to terminate a long-running task
</textarea>
