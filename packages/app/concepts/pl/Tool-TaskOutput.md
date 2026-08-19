# TaskOutput

Pobiera zgromadzone wyjście działającego lub ukończonego zadania w tle — polecenia powłoki w tle, lokalnego agenta lub zdalnej sesji. Użyj, gdy musisz sprawdzić, co długo działające zadanie dotychczas wytworzyło.

## Kiedy używać

- Zdalna sesja (na przykład sandbox w chmurze) działa i potrzebujesz jej stdout.
- Lokalny agent został wysłany w tle i chcesz częściowego postępu, zanim zwróci.
- Polecenie powłoki w tle działa wystarczająco długo, że chcesz sprawdzić jego stan bez zatrzymywania go.
- Musisz potwierdzić, że zadanie w tle faktycznie robi postępy, zanim poczekasz dłużej lub wywołasz `TaskStop`.

Nie sięgaj po `TaskOutput` odruchowo. Dla większości pracy w tle istnieje bardziej bezpośrednia ścieżka — zobacz uwagi poniżej.

## Parametry

- `task_id` (string, wymagany): Identyfikator zadania zwrócony, gdy praca w tle została uruchomiona. Nie jest taki sam jak `taskId` z listy zadań; jest to uchwyt czasu wykonania dla konkretnego wykonania.
- `block` (boolean, opcjonalny): Gdy `true` (domyślnie), czekaj, aż zadanie wyprodukuje nowe wyjście lub zakończy się, przed powrotem. Gdy `false`, wróć natychmiast z tym, co jest zbuforowane.
- `timeout` (liczba, opcjonalny): Maksymalna liczba milisekund blokowania przed powrotem. Znaczący tylko, gdy `block` to `true`. Domyślnie `30000`, maksymalnie `600000`.

## Przykłady

### Przykład 1

Zajrzyj do zdalnej sesji bez blokowania.

```
TaskOutput(task_id: "sess_01HXYZ...", block: false)
```

Zwraca wszelkie stdout/stderr wyprodukowane od rozpoczęcia zadania (lub od ostatniego wywołania `TaskOutput`, w zależności od środowiska uruchomieniowego).

### Przykład 2

Poczekaj krótko, aż lokalny agent wyprodukuje więcej wyjścia.

```
TaskOutput(
  task_id: "agent_01ABCD...",
  block: true,
  timeout: 10000
)
```

## Uwagi

- Polecenia bash w tle: `TaskOutput` jest praktycznie przestarzały dla tego przypadku użycia. Gdy rozpoczynasz zadanie powłoki w tle, wynik już zawiera ścieżkę do jego pliku wyjściowego — odczytaj tę ścieżkę bezpośrednio narzędziem `Read`. `Read` daje dostęp losowy, offset wierszy i stabilny widok; `TaskOutput` nie.
- Lokalni agenci (narzędzie `Agent` wysłane w tle): gdy agent zakończy, wynik narzędzia `Agent` już zawiera jego końcową odpowiedź. Użyj jej bezpośrednio. Nie wywołuj `Read` na symlinkowanym pliku transkryptu — zawiera pełny strumień wywołań narzędzi i przepełni okno kontekstu.
- Zdalne sesje: `TaskOutput` to poprawny i często jedyny sposób na strumieniowanie wyjścia. Preferuj `block: true` ze skromnym `timeout` nad ciasne pętle pollingu.
- Nieznany `task_id` lub zadanie, którego wyjście zostało zebrane przez śmieciarkę, zwraca błąd. Wyślij pracę ponownie, jeśli nadal jej potrzebujesz.
- `TaskOutput` nie zatrzymuje zadania. Użyj `TaskStop`, aby zakończyć.
