# Read

## Definicja

Odczytuje zawartość pliku z lokalnego systemu plików. Obsługuje pliki tekstowe, obrazy, PDF i Jupyter notebook.

## Parametry

| Parametr | Typ | Wymagany | Opis |
|------|------|------|------|
| `file_path` | string | Tak | Bezwzględna ścieżka do pliku |
| `offset` | number | Nie | Numer linii początkowej (do segmentowego odczytu dużych plików) |
| `limit` | number | Nie | Liczba linii do odczytu (do segmentowego odczytu dużych plików) |
| `pages` | string | Nie | Zakres stron PDF (np. "1-5", "3", "10-20"), dotyczy tylko PDF |

## Scenariusze użycia

**Odpowiednie zastosowanie:**
- Odczyt plików kodu, plików konfiguracyjnych i innych plików tekstowych
- Przeglądanie plików graficznych (Claude jest modelem multimodalnym)
- Odczyt dokumentów PDF
- Odczyt Jupyter notebook (zwraca wszystkie komórki z wyjściem)
- Równoległy odczyt wielu plików w celu uzyskania kontekstu

**Nieodpowiednie zastosowanie:**
- Odczyt katalogów — należy użyć polecenia `ls` w Bash
- Otwarta eksploracja bazy kodu — należy użyć Task (typ Explore)

## Uwagi

- Ścieżka musi być bezwzględna, nie może być względna
- Domyślnie odczytuje pierwsze 2000 linii pliku
- Linie przekraczające 2000 znaków zostaną obcięte
- Wyjście używa formatu `cat -n`, numery linii zaczynają się od 1
- Duże pliki PDF (ponad 10 stron) muszą mieć określony parametr `pages`, maksymalnie 20 stron na raz
- Odczyt nieistniejącego pliku zwróci błąd (nie spowoduje awarii)
- Można równolegle wywoływać wiele Read w jednej wiadomości

## Znaczenie w cc-viewer

Wywołania Read w logach żądań pojawiają się jako pary bloków content `tool_use` (wywołanie) i `tool_result` (zwrócona zawartość). `tool_result` zawiera faktyczną zawartość pliku, co pozwala analizować, które pliki model odczytał.

## Tekst oryginalny

<textarea readonly>Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to 2000 lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters
- Any lines longer than 2000 characters will be truncated
- Results are returned using cat -n format, with line numbers starting at 1
- This tool allows Claude Code to read images (eg PNG, JPG, etc). When reading an image file the contents are presented visually as Claude Code is a multimodal LLM.
- This tool can read PDF files (.pdf). For large PDFs (more than 10 pages), you MUST provide the pages parameter to read specific page ranges (e.g., pages: "1-5"). Reading a large PDF without the pages parameter will fail. Maximum 20 pages per request.
- This tool can read Jupyter notebooks (.ipynb files) and returns all cells with their outputs, combining code, text, and visualizations.
- This tool can only read files, not directories. To read a directory, use an ls command via the Bash tool.
- You can call multiple tools in a single response. It is always better to speculatively read multiple potentially useful files in parallel.
- You will regularly be asked to read screenshots. If the user provides a path to a screenshot, ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.</textarea>
