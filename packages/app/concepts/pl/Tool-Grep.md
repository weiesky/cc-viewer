# Grep

Przeszukuje zawartość plików przy użyciu silnika ripgrep. Oferuje pełne wsparcie wyrażeń regularnych, filtrowanie typów plików oraz trzy tryby wyjścia, aby można było wymieniać precyzję na zwięzłość.

## Kiedy używać

- Lokalizowanie wszystkich miejsc wywołania funkcji lub wszystkich odniesień do identyfikatora
- Sprawdzanie, czy ciąg lub komunikat błędu pojawia się gdziekolwiek w bazie kodu
- Liczenie wystąpień wzorca, aby oszacować wpływ przed refaktoringiem
- Zawężanie wyszukiwania do typu pliku (`type: "ts"`) lub glob (`glob: "**/*.tsx"`)
- Wyciąganie dopasowań wielolinijkowych, takich jak wielolinijkowe definicje struktur lub bloki JSX, za pomocą `multiline: true`

## Parametry

- `pattern` (string, wymagany): Wyrażenie regularne do wyszukania. Używa składni ripgrep, więc dosłowne nawiasy klamrowe wymagają ekranowania (na przykład `interface\{\}`, aby znaleźć `interface{}`).
- `path` (string, opcjonalny): Plik lub katalog do przeszukania. Domyślnie bieżący katalog roboczy.
- `glob` (string, opcjonalny): Filtr nazwy pliku, taki jak `*.js` lub `*.{ts,tsx}`.
- `type` (string, opcjonalny): Skrót typu pliku, taki jak `js`, `py`, `rust`, `go`. Bardziej wydajny niż `glob` dla standardowych języków.
- `output_mode` (enum, opcjonalny): `files_with_matches` (domyślny, zwraca tylko ścieżki), `content` (zwraca pasujące wiersze) lub `count` (zwraca zliczenia dopasowań).
- `-i` (boolean, opcjonalny): Dopasowanie bez uwzględniania wielkości liter.
- `-n` (boolean, opcjonalny): Dołącza numery wierszy w trybie `content`. Domyślnie `true`.
- `-A` (liczba, opcjonalny): Liczba wierszy kontekstu do pokazania po każdym dopasowaniu (wymaga trybu `content`).
- `-B` (liczba, opcjonalny): Liczba wierszy kontekstu przed każdym dopasowaniem (wymaga trybu `content`).
- `-C` / `context` (liczba, opcjonalny): Liczba wierszy kontekstu po obu stronach każdego dopasowania.
- `multiline` (boolean, opcjonalny): Pozwala wzorcom obejmować znaki nowego wiersza (`.` dopasowuje `\n`). Domyślnie `false`.
- `head_limit` (liczba, opcjonalny): Ograniczenie zwróconych wierszy, ścieżek plików lub wpisów zliczeń. Domyślnie 250; przekaż `0` dla braku limitu (używaj oszczędnie).
- `offset` (liczba, opcjonalny): Pomiń pierwsze N wyników przed zastosowaniem `head_limit`. Domyślnie `0`.

## Przykłady

### Przykład 1: Znajdź wszystkie miejsca wywołania funkcji
Ustaw `pattern: "registerHandler\\("`, `output_mode: "content"` i `-C: 2`, aby zobaczyć otaczające wiersze każdego wywołania.

### Przykład 2: Policz dopasowania w ramach typu
Ustaw `pattern: "TODO"`, `type: "py"` i `output_mode: "count"`, aby zobaczyć sumy TODO na plik w źródłach Pythona.

### Przykład 3: Dopasowanie wielolinijkowej struktury
Użyj `pattern: "struct Config \\{[\\s\\S]*?version"` z `multiline: true`, aby uchwycić pole zadeklarowane kilka linii wewnątrz struktury Go.

## Uwagi

- Zawsze preferuj `Grep` nad uruchamianiem `grep` lub `rg` przez `Bash`; narzędzie jest zoptymalizowane pod kątem poprawnych uprawnień i ustrukturyzowanego wyjścia.
- Domyślny tryb wyjścia to `files_with_matches`, który jest najtańszy. Przełącz się na `content` tylko wtedy, gdy musisz zobaczyć same wiersze.
- Flagi kontekstu (`-A`, `-B`, `-C`) są ignorowane, chyba że `output_mode` to `content`.
- Duże zbiory wyników zużywają tokeny kontekstu. Używaj `head_limit`, `offset` lub bardziej ciasnych filtrów `glob`/`type`, aby zachować koncentrację.
- Do odkrywania nazw plików używaj `Glob`; do otwartych badań obejmujących wiele rund wysyłaj `Agent` z agentem Explore.
