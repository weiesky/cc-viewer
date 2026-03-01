# Write

## Definition

Schreibt Inhalte in das lokale Dateisystem. Überschreibt die Datei, falls sie bereits existiert.

## Parameter

| Parameter | Typ | Erforderlich | Beschreibung |
|-----------|-----|--------------|--------------|
| `file_path` | string | Ja | Absoluter Pfad der Datei (muss ein absoluter Pfad sein) |
| `content` | string | Ja | Der zu schreibende Inhalt |

## Anwendungsfälle

**Geeignet für:**
- Neue Dateien erstellen
- Wenn der Dateiinhalt vollständig neu geschrieben werden muss

**Nicht geeignet für:**
- Teilinhalte einer Datei ändern – dafür Edit verwenden
- Nicht proaktiv Dokumentationsdateien (*.md) oder READMEs erstellen, es sei denn, der Benutzer fordert es ausdrücklich an

## Hinweise

- Wenn die Zieldatei bereits existiert, muss sie zuerst über Read gelesen werden, sonst schlägt der Vorgang fehl
- Überschreibt den gesamten Inhalt einer vorhandenen Datei
- Edit zum Bearbeiten vorhandener Dateien bevorzugen; Write nur für neue Dateien oder vollständige Neuschreibungen verwenden

## Bedeutung in cc-viewer

Write-Aufrufe erscheinen im Anfrage-Log als `tool_use` Content Block, dessen `input.content` den vollständigen geschriebenen Inhalt enthält.

## Originaltext

<textarea readonly>Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.</textarea>
