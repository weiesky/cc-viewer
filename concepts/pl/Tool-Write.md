# Write

## Definicja

Zapisuje zawartość do lokalnego systemu plików. Jeśli plik już istnieje, nadpisuje go.

## Parametry

| Parametr | Typ | Wymagany | Opis |
|------|------|------|------|
| `file_path` | string | Tak | Bezwzględna ścieżka do pliku (musi być bezwzględna) |
| `content` | string | Tak | Zawartość do zapisania |

## Scenariusze użycia

**Odpowiednie zastosowanie:**
- Tworzenie nowych plików
- Gdy wymagane jest całkowite przepisanie zawartości pliku

**Nieodpowiednie zastosowanie:**
- Modyfikacja lokalnej zawartości pliku — należy użyć Edit
- Nie należy proaktywnie tworzyć plików dokumentacji (*.md) ani README, chyba że użytkownik wyraźnie o to prosi

## Uwagi

- Jeśli plik docelowy już istnieje, należy go najpierw odczytać za pomocą Read, w przeciwnym razie operacja się nie powiedzie
- Nadpisuje całą zawartość istniejącego pliku
- Preferuj Edit do edycji istniejących plików, Write służy tylko do tworzenia nowych plików lub całkowitego przepisywania

## Znaczenie w cc-viewer

Wywołanie Write w logach żądań pojawia się jako blok content `tool_use`, którego `input.content` zawiera pełną zapisaną zawartość.

## Tekst oryginalny

<textarea readonly>Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.</textarea>
