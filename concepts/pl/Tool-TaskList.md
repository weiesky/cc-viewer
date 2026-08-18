# TaskList

Zwraca każde zadanie w bieżącym zespole (lub sesji) w formie podsumowania. Użyj, aby przejrzeć zaległe prace, zdecydować, co podjąć dalej, i uniknąć tworzenia duplikatów.

## Kiedy używać

- Na początku sesji, aby zobaczyć, co jest już śledzone.
- Przed wywołaniem `TaskCreate`, aby potwierdzić, że praca nie jest już uchwycona.
- Przy decydowaniu, które zadanie roszczyć jako współpracownik lub podagent.
- Aby szybko zweryfikować relacje zależności w zespole.
- Okresowo podczas długich sesji, aby ponownie zsynchronizować się ze współpracownikami, którzy mogli rościć, ukończyć lub dodać zadania.

`TaskList` jest tylko do odczytu i tani; wywołuj swobodnie, gdy potrzebujesz przeglądu.

## Aktywacja

- Dostępne domyślnie na większości modeli.
- Niedostępne na rodzinach Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 i nowszych (v2.1.233+), chyba że włączone przez `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` lub `--tools`.
- Cały system zadań jest wyłączony, gdy `CLAUDE_CODE_ENABLE_TASKS=false`.

## Parametry

`TaskList` nie przyjmuje parametrów. Zawsze zwraca pełny zbiór zadań dla aktywnego kontekstu.

## Kształt odpowiedzi

Każde zadanie na liście to podsumowanie, a nie pełny rekord. Oczekuj około:

- `id` — stabilny identyfikator do użycia z `TaskGet` / `TaskUpdate`.
- `subject` — krótki tytuł w trybie rozkazującym.
- `status` — jeden z `pending`, `in_progress`, `completed`, `deleted`.
- `owner` — uchwyt agenta lub współpracownika, lub pusty, gdy nieroszczony.
- `blockedBy` — tablica ID zadań, które muszą ukończyć się najpierw.

Dla pełnego opisu, kryteriów akceptacji lub metadanych konkretnego zadania, kontynuuj z `TaskGet`.

## Przykłady

### Przykład 1

Szybkie sprawdzenie statusu.

```
TaskList()
```

Przeskanuj wyjście pod kątem wszystkiego `in_progress` bez `owner` (praca zastała) oraz wszystkiego `pending` z pustym `blockedBy` (gotowe do podjęcia).

### Przykład 2

Współpracownik wybierający następne zadanie.

```
TaskList()
# Filter to: status == pending AND blockedBy is empty AND owner is empty.
# Among those, prefer the lower ID (tasks are typically numbered in
# creation order, so lower IDs are older and usually higher priority).
TaskGet(taskId: "<chosen id>")
TaskUpdate(taskId: "<chosen id>", status: "in_progress", owner: "<your handle>")
```

## Uwagi

- Heurystyka dla współpracowników: gdy wiele zadań `pending` jest odblokowanych i nieroszczonych, wybierz najniższy ID. To utrzymuje kolejność FIFO i unika sytuacji, w której dwóch agentów chwyta to samo głośne zadanie.
- Szanuj `blockedBy`: nie rozpoczynaj zadania, którego blokery są nadal `pending` lub `in_progress`. Najpierw rozwiąż blokera lub koordynuj z jego właścicielem.
- `TaskList` to jedyny mechanizm odkrywania zadań. Nie ma wyszukiwania; jeśli lista jest długa, skanuj strukturalnie (po statusie, potem po właścicielu).
- Usunięte zadania mogą nadal pojawiać się na liście ze statusem `deleted` dla celów śledzenia. Ignoruj je przy planowaniu.
- Lista odzwierciedla aktualny stan zespołu, więc współpracownicy mogą dodawać lub roszczyć zadania między wywołaniami. Wylistuj ponownie przed roszczeniem, jeśli minął czas.
