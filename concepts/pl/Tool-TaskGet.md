# TaskGet

Pobiera pełny rekord pojedynczego zadania po ID, wraz z jego opisem, bieżącym statusem, właścicielem, metadanymi i krawędziami zależności. Użyj, gdy podsumowanie zwrócone przez `TaskList` nie wystarcza, aby działać na zadaniu.

## Kiedy używać

- Wybrałeś zadanie z `TaskList` i potrzebujesz pełnego opisu przed rozpoczęciem pracy.
- Zaraz oznaczysz zadanie jako `completed` i chcesz ponownie sprawdzić kryteria akceptacji.
- Musisz sprawdzić, jakie zadania to blokuje lub przez co jest `blockedBy`, aby zdecydować o kolejnym ruchu.
- Badasz historię — kto jest właścicielem, jakie metadane zostały dołączone, kiedy zmienił się stan.
- Współpracownik lub wcześniejsza sesja odwołała się do ID zadania i potrzebujesz kontekstu.

Preferuj `TaskList`, gdy potrzebujesz tylko przeglądu wysokiego poziomu; zarezerwuj `TaskGet` dla konkretnego rekordu, który zamierzasz dokładnie przeczytać lub zmodyfikować.

## Aktywacja

- Dostępne domyślnie na większości modeli.
- Niedostępne na rodzinach Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 i nowszych (v2.1.233+), chyba że włączone przez `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` lub `--tools`.
- Cały system zadań jest wyłączony, gdy `CLAUDE_CODE_ENABLE_TASKS=false`.

## Parametry

- `taskId` (string, wymagany): Identyfikator zadania zwrócony przez `TaskCreate` lub `TaskList`. Identyfikatory są stałe przez cały okres życia zadania.

## Przykłady

### Przykład 1

Wyszukaj zadanie, które właśnie zobaczyłeś na liście.

```
TaskGet(taskId: "t_01HXYZ...")
```

Typowe pola odpowiedzi: `id`, `subject`, `description`, `activeForm`, `status`, `owner`, `blocks`, `blockedBy`, `metadata`, `createdAt`, `updatedAt`.

### Przykład 2

Rozwiąż zależności przed rozpoczęciem.

```
TaskGet(taskId: "t_01HXYZ...")
# Inspect blockedBy — if any referenced task is still pending
# or in_progress, work on the blocker first.
```

## Uwagi

- `TaskGet` jest tylko do odczytu i bezpieczne w powtarzalnych wywołaniach; nie zmienia statusu ani własności.
- Jeśli `blockedBy` jest niepuste i zawiera zadania, które nie są `completed`, nie zaczynaj tego zadania — najpierw rozwiąż blokady (lub koordynuj z ich właścicielem).
- Pole `description` może być długie. Przeczytaj je w całości przed działaniem; pobieżne czytanie prowadzi do pominiętych kryteriów akceptacji.
- Nieznany lub usunięty `taskId` zwraca błąd. Uruchom ponownie `TaskList`, aby wybrać bieżący ID.
- Jeśli zamierzasz edytować zadanie, najpierw wywołaj `TaskGet`, aby uniknąć nadpisania pól, które współpracownik właśnie zmienił.
