# ToolSearch

Pobiera na żądanie pełne definicje schematów „odroczonych narzędzi", aby stały się wywoływalne. Gdy dostępnych jest wiele narzędzi, część z nich nie jest ładowana z góry — pojawiają się jedynie z nazwy wewnątrz wiadomości `<system-reminder>`. Dopóki jego schemat nie zostanie pobrany, znana jest tylko nazwa, a nie ma definicji parametrów, więc narzędzia nie da się wywołać. `ToolSearch` przyjmuje zapytanie, dopasowuje je do listy odroczonych narzędzi i zwraca pełne definicje JSONSchema dopasowanych narzędzi wewnątrz bloku `<functions>`. Gdy schemat narzędzia pojawi się w wyniku, można je wywołać dokładnie tak jak każde narzędzie zdefiniowane na początku promptu.

## Kiedy używać

- Potrzebujesz odroczonego narzędzia — jego nazwa pojawia się w `<system-reminder>`, ale na liście narzędzi najwyższego poziomu nie ma dla niego definicji parametrów.
- Chcesz użyć narzędzi serwera MCP (np. Slack, Gmail, computer-use), które są ładowane na żądanie.
- Nie masz pewności co do dokładnej nazwy narzędzia dla danej funkcji i chcesz jednym ruchem wyłonić kandydatów według słowa kluczowego.

Jeśli schemat narzędzia jest już w kontekście, nie szukaj ponownie — po prostu je wywołaj.

## Aktywacja

- Domyślnie włączone.
- Wyłączone, gdy `ANTHROPIC_BASE_URL` wskazuje na punkt końcowy inny niż Anthropic (chyba że ustawione jest `ENABLE_TOOL_SEARCH`), gdy ustawione jest `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`, gdy model nie obsługuje odwołań do narzędzi (modele Vertex AI sprzed Claude 4.5) lub gdy zablokowane przez `"deny": ["ToolSearch"]`.

## Parametry

- `query` (string, wymagany): Zapytanie używane do zlokalizowania odroczonych narzędzi. Obsługiwane są trzy formy:
  - `select:Read,Edit,Grep` — pobierz dokładnie te narzędzia po nazwie.
  - `notebook jupyter` — wyszukiwanie po słowach kluczowych, zwracające do `max_results` najlepszych dopasowań.
  - `+slack send` — wymagaj, aby `slack` występował w nazwie narzędzia, a następnie uszereguj według pozostałych terminów.
- `max_results` (number, opcjonalny): Maksymalna liczba zwracanych wyników. Domyślnie 5.

## Przykłady

### Przykład 1: Pobieranie po dokładnej nazwie

```
ToolSearch(query="select:WebFetch,WebSearch", max_results=5)
```

### Przykład 2: Wyszukiwanie po słowach kluczowych

```
ToolSearch(query="notebook jupyter", max_results=5)
```

### Przykład 3: Załadowanie całego zestawu MCP naraz

Podczas masowego ładowania wszystkich narzędzi serwera MCP (np. computer-use) użyj jednego wyszukiwania po słowie kluczowym zamiast wybierania każdego z osobna — nazwa serwera jako podciąg dopasowuje każde narzędzie tego serwera:

```
ToolSearch(query="computer-use", max_results=30)
```

## Uwagi

- Przed wywołaniem odroczonego narzędzia musisz najpierw pobrać jego schemat za pomocą `ToolSearch` — wywołanie go bezpośrednio kończy się niepowodzeniem, ponieważ brakuje definicji parametrów.
- Podczas masowego ładowania całego zestawu (np. wszystkich narzędzi serwera MCP) preferuj jedno wyszukiwanie po słowie kluczowym zamiast wielu wywołań `select:`, aby ograniczyć liczbę zapytań.
- Gdy schemat zostanie pobrany, narzędzie zachowuje się dokładnie jak każde zwykłe narzędzie; nie wyszukuj ponownie tego samego narzędzia.
- Wyniki wracają jako blok `<functions>`, każde narzędzie w jednym wierszu `<function>{...}</function>` — w tym samym kodowaniu co lista narzędzi najwyższego poziomu.
