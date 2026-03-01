# TaskOutput

## Definicja

Pobiera wynik działającego lub zakończonego zadania w tle. Dotyczy powłok w tle, asynchronicznych agentów i sesji zdalnych.

## Parametry

| Parametr | Typ | Wymagany | Opis |
|------|------|------|------|
| `task_id` | string | Tak | ID zadania |
| `block` | boolean | Tak | Czy blokować do zakończenia zadania, domyślnie `true` |
| `timeout` | number | Tak | Maksymalny czas oczekiwania (milisekundy), domyślnie 30000, maks. 600000 |

## Scenariusze użycia

**Odpowiednie zastosowanie:**
- Sprawdzanie postępu agenta w tle uruchomionego przez Task (`run_in_background: true`)
- Pobieranie wyników poleceń Bash uruchomionych w tle
- Oczekiwanie na zakończenie zadania asynchronicznego i pobranie wyniku

**Nieodpowiednie zastosowanie:**
- Zadania na pierwszym planie — zadania na pierwszym planie zwracają wynik bezpośrednio, to narzędzie nie jest potrzebne

## Uwagi

- `block: true` blokuje do zakończenia zadania lub upływu limitu czasu
- `block: false` służy do nieblokującego sprawdzenia bieżącego stanu
- ID zadania można znaleźć za pomocą polecenia `/tasks`
- Dotyczy wszystkich typów zadań: powłoki w tle, asynchroniczne agenty, sesje zdalne

## Znaczenie w cc-viewer

Wywołanie TaskOutput samo w sobie nie generuje żądania API — jest to wewnętrzna operacja zarządzania zadaniami Claude Code i nie pojawia się w logach żądań.

## Tekst oryginalny

<textarea readonly>- Retrieves output from a running or completed task (background shell, agent, or remote session)
- Takes a task_id parameter identifying the task
- Returns the task output along with status information
- Use block=true (default) to wait for task completion
- Use block=false for non-blocking check of current status
- Task IDs can be found using the /tasks command
- Works with all task types: background shells, async agents, and remote sessions</textarea>
