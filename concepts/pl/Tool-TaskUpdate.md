# TaskUpdate

Modyfikuje istniejące zadanie — jego status, treść, własność, metadane lub krawędzie zależności. To sposób, w jaki zadania postępują przez swój cykl życia i w jaki praca jest przekazywana między Claude Code, współpracownikami i podagentami.

## Kiedy używać

- Przechodzenie zadania przez przepływ statusów podczas pracy nad nim.
- Roszczenie zadania przez przypisanie siebie (lub innego agenta) jako `owner`.
- Dopracowywanie `subject` lub `description` po dowiedzeniu się więcej o problemie.
- Zapisywanie nowo odkrytych zależności za pomocą `addBlocks` / `addBlockedBy`.
- Dołączanie ustrukturyzowanych `metadata`, takich jak zewnętrzne ID ticketów lub wskazówki priorytetowe.

## Aktywacja

- Dostępne domyślnie na większości modeli.
- Niedostępne na rodzinach Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 i nowszych (v2.1.233+), chyba że włączone przez `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` lub `--tools`.
- Cały system zadań jest wyłączony, gdy `CLAUDE_CODE_ENABLE_TASKS=false`.

## Parametry

- `taskId` (string, wymagany): Zadanie do zmodyfikowania. Uzyskaj z `TaskList` lub `TaskCreate`.
- `status` (string, opcjonalny): Jeden z `pending`, `in_progress`, `completed`, `deleted`.
- `subject` (string, opcjonalny): Zastępczy tytuł w trybie rozkazującym.
- `description` (string, opcjonalny): Zastępczy szczegółowy opis.
- `activeForm` (string, opcjonalny): Zastępczy tekst wskaźnika w czasie ciągłym teraźniejszym.
- `owner` (string, opcjonalny): Uchwyt agenta lub współpracownika biorącego odpowiedzialność za zadanie.
- `metadata` (obiekt, opcjonalny): Klucze metadanych do scalenia z zadaniem. Ustaw klucz na `null`, aby go usunąć.
- `addBlocks` (tablica stringów, opcjonalny): ID zadań, które to zadanie blokuje.
- `addBlockedBy` (tablica stringów, opcjonalny): ID zadań, które muszą ukończyć się przed tym.

## Przepływ statusów

Cykl życia jest celowo liniowy: `pending` → `in_progress` → `completed`. `deleted` jest terminalny i używany do wycofywania zadań, nad którymi nigdy nie będzie pracy.

- Ustaw `in_progress` w momencie, gdy faktycznie rozpoczynasz pracę, nie wcześniej. Tylko jedno zadanie naraz powinno być `in_progress` dla danego właściciela.
- Ustaw `completed` tylko wtedy, gdy praca jest całkowicie ukończona — kryteria akceptacji spełnione, testy przechodzą, wyjście zapisane. Jeśli pojawi się bloker, utrzymuj zadanie w `in_progress` i dodaj nowe zadanie opisujące, co musi zostać rozwiązane.
- Nigdy nie oznaczaj zadania jako `completed`, gdy testy się nie powodzą, implementacja jest częściowa lub napotkałeś nierozwiązane błędy.
- Używaj `deleted` dla zadań anulowanych lub zduplikowanych; nie przekształcaj zadania w niepowiązaną pracę.

## Przykłady

### Przykład 1

Zrosz zadanie i rozpocznij je.

```
TaskUpdate(
  taskId: "t_01HXYZ...",
  status: "in_progress",
  owner: "main-agent"
)
```

### Przykład 2

Zakończ pracę i zapisz zależność kolejnego kroku.

```
TaskUpdate(
  taskId: "t_01HXYZ...",
  status: "completed"
)

TaskUpdate(
  taskId: "t_01FOLLOWUP...",
  addBlockedBy: ["t_01HXYZ..."]
)
```

## Uwagi

- `metadata` scalają się klucz po kluczu; przekazanie `null` dla klucza go usuwa. Najpierw wywołaj `TaskGet`, jeśli nie jesteś pewien bieżącej zawartości.
- `addBlocks` i `addBlockedBy` dopisują krawędzie; nie usuwają istniejących. Destrukcyjna edycja grafu wymaga dedykowanego przepływu pracy — skonsultuj się z właścicielem zespołu przed przepisaniem zależności.
- Utrzymuj `activeForm` zsynchronizowany, gdy zmieniasz `subject`, aby tekst wskaźnika brzmiał nadal naturalnie.
- Nie oznaczaj zadania jako `completed`, aby je wyciszyć. Jeśli użytkownik anulował pracę, użyj `deleted` z krótkim uzasadnieniem w `description`.
- Odczytaj najnowszy stan zadania przez `TaskGet` przed aktualizacją — współpracownicy mogli go zmienić między Twoim ostatnim odczytem a zapisem.
