# Glob

## Definicja

Szybkie narzędzie do dopasowywania wzorców nazw plików, obsługujące bazy kodu dowolnej wielkości. Zwraca pasujące ścieżki plików posortowane według czasu modyfikacji.

## Parametry

| Parametr | Typ | Wymagany | Opis |
|------|------|------|------|
| `pattern` | string | Tak | Wzorzec glob (np. `**/*.js`, `src/**/*.ts`) |
| `path` | string | Nie | Katalog wyszukiwania, domyślnie bieżący katalog roboczy. Nie przekazuj "undefined" ani "null" |

## Scenariusze użycia

**Odpowiednie zastosowanie:**
- Wyszukiwanie plików według wzorca nazwy
- Wyszukiwanie wszystkich plików określonego typu (np. wszystkie pliki `.tsx`)
- Lokalizowanie plików przy wyszukiwaniu definicji klasy (np. `class Foo`)
- Można równolegle wysyłać wiele wywołań Glob w jednej wiadomości

**Nieodpowiednie zastosowanie:**
- Wyszukiwanie zawartości plików — należy użyć Grep
- Otwarta eksploracja wymagająca wielu rund wyszukiwania — należy użyć Task (typ Explore)

## Uwagi

- Obsługuje standardową składnię glob: `*` dopasowuje jeden poziom, `**` dopasowuje wiele poziomów, `{}` dopasowuje wielokrotny wybór
- Wyniki posortowane według czasu modyfikacji
- Bardziej zalecane niż polecenie `find` w Bash

## Znaczenie w cc-viewer

Wywołania Glob w logach żądań pojawiają się jako pary bloków content `tool_use` / `tool_result`. `tool_result` zawiera listę pasujących ścieżek plików.

## Tekst oryginalny

<textarea readonly>- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead
- You can call multiple tools in a single response. It is always better to speculatively perform multiple searches in parallel if they are potentially useful.</textarea>
