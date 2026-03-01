# Read

## Definition

Liest Dateiinhalte aus dem lokalen Dateisystem. Unterstützt Textdateien, Bilder, PDF und Jupyter Notebooks.

## Parameter

| Parameter | Typ | Erforderlich | Beschreibung |
|-----------|-----|--------------|--------------|
| `file_path` | string | Ja | Absoluter Pfad der Datei |
| `offset` | number | Nein | Startzeilennummer (für abschnittsweises Lesen großer Dateien) |
| `limit` | number | Nein | Anzahl zu lesender Zeilen (für abschnittsweises Lesen großer Dateien) |
| `pages` | string | Nein | PDF-Seitenbereich (z.B. "1-5", "3", "10-20"), nur für PDF |

## Anwendungsfälle

**Geeignet für:**
- Codedateien, Konfigurationsdateien und andere Textdateien lesen
- Bilddateien anzeigen (Claude ist ein multimodales Modell)
- PDF-Dokumente lesen
- Jupyter Notebooks lesen (gibt alle Zellen mit Ausgaben zurück)
- Mehrere Dateien parallel lesen, um Kontext zu erhalten

**Nicht geeignet für:**
- Verzeichnisse lesen – dafür den `ls`-Befehl in Bash verwenden
- Offene Codebasis-Erkundung – dafür Task (Explore-Typ) verwenden

## Hinweise

- Der Pfad muss ein absoluter Pfad sein, kein relativer Pfad
- Standardmäßig werden die ersten 2000 Zeilen der Datei gelesen
- Zeilen mit mehr als 2000 Zeichen werden abgeschnitten
- Die Ausgabe verwendet das `cat -n`-Format, Zeilennummern beginnen bei 1
- Große PDFs (über 10 Seiten) erfordern den `pages`-Parameter, maximal 20 Seiten pro Aufruf
- Das Lesen einer nicht existierenden Datei gibt einen Fehler zurück (kein Absturz)
- Mehrere Read-Aufrufe können in einer einzelnen Nachricht parallel ausgeführt werden

## Bedeutung in cc-viewer

Read-Aufrufe erscheinen im Anfrage-Log als `tool_use` (Aufruf) und `tool_result` (zurückgegebener Inhalt) Content-Block-Paare. `tool_result` enthält den tatsächlichen Dateiinhalt und kann zur Analyse verwendet werden, welche Dateien das Modell gelesen hat.

## Originaltext

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
