# Glob

## Definition

Schnelles Dateinamen-Musterabgleich-Tool, das mit Codebasen jeder Größe funktioniert. Gibt übereinstimmende Dateipfade sortiert nach Änderungszeit zurück.

## Parameter

| Parameter | Typ | Erforderlich | Beschreibung |
|-----------|-----|--------------|--------------|
| `pattern` | string | Ja | Glob-Muster (z.B. `**/*.js`, `src/**/*.ts`) |
| `path` | string | Nein | Suchverzeichnis, Standard ist das aktuelle Arbeitsverzeichnis. Nicht "undefined" oder "null" übergeben |

## Anwendungsfälle

**Geeignet für:**
- Dateien nach Dateinamenmuster suchen
- Alle Dateien eines bestimmten Typs finden (z.B. alle `.tsx`-Dateien)
- Beim Suchen einer bestimmten Klassendefinition (z.B. `class Foo`) zuerst die Datei lokalisieren
- Mehrere Glob-Aufrufe können in einer einzelnen Nachricht parallel gestartet werden

**Nicht geeignet für:**
- Dateiinhalte durchsuchen – dafür Grep verwenden
- Offene Erkundung mit mehreren Suchrunden – dafür Task (Explore-Typ) verwenden

## Hinweise

- Unterstützt Standard-Glob-Syntax: `*` matcht eine Ebene, `**` matcht mehrere Ebenen, `{}` matcht Alternativen
- Ergebnisse sind nach Änderungszeit sortiert
- Wird gegenüber dem `find`-Befehl in Bash bevorzugt

## Bedeutung in cc-viewer

Glob-Aufrufe erscheinen im Anfrage-Log als `tool_use` / `tool_result` Content-Block-Paare. `tool_result` enthält die Liste der übereinstimmenden Dateipfade.

## Originaltext

<textarea readonly>- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead
- You can call multiple tools in a single response. It is always better to speculatively perform multiple searches in parallel if they are potentially useful.</textarea>
