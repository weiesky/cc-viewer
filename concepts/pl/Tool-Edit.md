# Edit

## Definicja

Edytuje plik poprzez precyzyjne zastępowanie ciągów znaków. Zastępuje `old_string` w pliku na `new_string`.

## Parametry

| Parametr | Typ | Wymagany | Opis |
|------|------|------|------|
| `file_path` | string | Tak | Bezwzględna ścieżka do pliku do modyfikacji |
| `old_string` | string | Tak | Oryginalny tekst do zastąpienia |
| `new_string` | string | Tak | Nowy tekst po zastąpieniu (musi różnić się od old_string) |
| `replace_all` | boolean | Nie | Czy zastąpić wszystkie wystąpienia, domyślnie `false` |

## Scenariusze użycia

**Odpowiednie zastosowanie:**
- Modyfikacja określonych fragmentów kodu w istniejących plikach
- Naprawianie błędów, aktualizacja logiki
- Zmiana nazw zmiennych (w połączeniu z `replace_all: true`)
- Każdy scenariusz wymagający precyzyjnej modyfikacji zawartości pliku

**Nieodpowiednie zastosowanie:**
- Tworzenie nowych plików — należy użyć Write
- Masowe przepisywanie — może wymagać Write do nadpisania całego pliku

## Uwagi

- Przed użyciem należy najpierw odczytać plik za pomocą Read, w przeciwnym razie wystąpi błąd
- `old_string` musi być unikalny w pliku, w przeciwnym razie edycja się nie powiedzie. Jeśli nie jest unikalny, należy podać więcej kontekstu lub użyć `replace_all`
- Podczas edycji tekstu należy zachować oryginalne wcięcia (tab/spacje), nie dołączać prefiksów numerów linii z wyjścia Read
- Preferowana jest edycja istniejących plików zamiast tworzenia nowych
- `new_string` musi różnić się od `old_string`

## Znaczenie w cc-viewer

Wywołanie Edit w logach żądań pojawia się jako blok content `tool_use`, którego `input` zawiera `old_string` i `new_string`, co pozwala śledzić, jakie modyfikacje model wprowadził w pliku.

## Tekst oryginalny

<textarea readonly>Performs exact string replacements in files.

Usage:
- You must use your `Read` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file. 
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if `old_string` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use `replace_all` to change every instance of `old_string`.
- Use `replace_all` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.</textarea>
