# Grep

## Definition

Leistungsstarkes Inhaltssuchtool basierend auf ripgrep. Unterstützt reguläre Ausdrücke, Dateitypfilterung und mehrere Ausgabemodi.

## Parameter

| Parameter | Typ | Erforderlich | Beschreibung |
|-----------|-----|--------------|--------------|
| `pattern` | string | Ja | Reguläres Ausdruckssuchmuster |
| `path` | string | Nein | Suchpfad (Datei oder Verzeichnis), Standard ist das aktuelle Arbeitsverzeichnis |
| `glob` | string | Nein | Dateinamenfilter (z.B. `*.js`, `*.{ts,tsx}`) |
| `type` | string | Nein | Dateitypfilter (z.B. `js`, `py`, `rust`), effizienter als glob |
| `output_mode` | enum | Nein | Ausgabemodus: `files_with_matches` (Standard), `content`, `count` |
| `-i` | boolean | Nein | Groß-/Kleinschreibung ignorieren |
| `-n` | boolean | Nein | Zeilennummern anzeigen (nur content-Modus), Standard true |
| `-A` | number | Nein | Anzahl der Zeilen nach dem Treffer |
| `-B` | number | Nein | Anzahl der Zeilen vor dem Treffer |
| `-C` / `context` | number | Nein | Anzahl der Zeilen vor und nach dem Treffer |
| `head_limit` | number | Nein | Ausgabeeinträge begrenzen, Standard 0 (unbegrenzt) |
| `offset` | number | Nein | Erste N Ergebnisse überspringen |
| `multiline` | boolean | Nein | Mehrzeiligen Abgleichmodus aktivieren, Standard false |

## Anwendungsfälle

**Geeignet für:**
- Bestimmte Zeichenketten oder Muster in der Codebasis suchen
- Verwendungsstellen von Funktionen/Variablen finden
- Suchergebnisse nach Dateityp filtern
- Trefferanzahl zählen

**Nicht geeignet für:**
- Dateien nach Dateinamen suchen – dafür Glob verwenden
- Offene Erkundung mit mehreren Suchrunden – dafür Task (Explore-Typ) verwenden

## Hinweise

- Verwendet ripgrep-Syntax (nicht grep), geschweifte Klammern und andere Sonderzeichen müssen escaped werden
- `files_with_matches`-Modus gibt nur Dateipfade zurück, am effizientesten
- `content`-Modus gibt übereinstimmende Zeileninhalte zurück, unterstützt Kontextzeilen
- Mehrzeiliger Abgleich erfordert `multiline: true`
- Immer das Grep-Tool gegenüber `grep` oder `rg` in Bash bevorzugen

## Bedeutung in cc-viewer

Grep-Aufrufe erscheinen im Anfrage-Log als `tool_use` / `tool_result` Content-Block-Paare. `tool_result` enthält die Suchergebnisse.

## Originaltext

<textarea readonly>A powerful search tool built on ripgrep

  Usage:
  - ALWAYS use Grep for search tasks. NEVER invoke `grep` or `rg` as a Bash command. The Grep tool has been optimized for correct permissions and access.
  - Supports full regex syntax (e.g., "log.*Error", "function\s+\w+")
  - Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")
  - Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts
  - Use Agent tool for open-ended searches requiring multiple rounds
  - Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping (use `interface\{\}` to find `interface{}` in Go code)
  - Multiline matching: By default patterns match within single lines only. For cross-line patterns like `struct \{[\s\S]*?field`, use `multiline: true`
</textarea>
