# Grep

Durchsucht Dateiinhalte mit der ripgrep-Engine. Bietet vollständige Unterstützung für reguläre Ausdrücke, Dateityp-Filter und drei Ausgabemodi, sodass Sie Präzision gegen Kompaktheit abwägen können.

## Wann verwenden

- Auffinden jeder Aufrufstelle einer Funktion oder jeder Referenz auf einen Bezeichner
- Prüfen, ob ein String oder eine Fehlermeldung irgendwo im Codebase vorkommt
- Zählen von Musterauftreten, um den Impact vor einem Refactoring einzuschätzen
- Einschränken einer Suche auf einen Dateityp (`type: "ts"`) oder Glob (`glob: "**/*.tsx"`)
- Zeilenübergreifende Treffer wie mehrzeilige Strukturdefinitionen oder JSX-Blöcke mit `multiline: true` herausziehen

## Parameter

- `pattern` (string, erforderlich): Der reguläre Ausdruck für die Suche. Nutzt die ripgrep-Syntax, literale geschweifte Klammern müssen escaped werden (zum Beispiel `interface\{\}`, um `interface{}` zu finden).
- `path` (string, optional): Datei oder Verzeichnis zum Durchsuchen. Standard ist das aktuelle Arbeitsverzeichnis.
- `glob` (string, optional): Dateinamensfilter wie `*.js` oder `*.{ts,tsx}`.
- `type` (string, optional): Dateityp-Kürzel wie `js`, `py`, `rust`, `go`. Effizienter als `glob` für Standardsprachen.
- `output_mode` (enum, optional): `files_with_matches` (Standard, gibt nur Pfade zurück), `content` (gibt übereinstimmende Zeilen zurück) oder `count` (gibt Trefferzahlen zurück).
- `-i` (boolean, optional): Groß-/Kleinschreibung ignorierende Suche.
- `-n` (boolean, optional): Zeilennummern in `content`-Modus einbeziehen. Standard ist `true`.
- `-A` (number, optional): Anzahl der Kontextzeilen nach jedem Treffer (erfordert `content`-Modus).
- `-B` (number, optional): Anzahl der Kontextzeilen vor jedem Treffer (erfordert `content`-Modus).
- `-C` / `context` (number, optional): Kontextzeilen auf beiden Seiten jedes Treffers.
- `multiline` (boolean, optional): Erlaubt Mustern, Zeilenumbrüche zu überspannen (`.` matcht `\n`). Standard ist `false`.
- `head_limit` (number, optional): Begrenzung der zurückgegebenen Zeilen, Dateipfade oder Zählwerte. Standard ist 250; `0` für unbegrenzt (sparsam verwenden).
- `offset` (number, optional): Überspringt die ersten N Ergebnisse, bevor `head_limit` angewendet wird. Standard ist `0`.

## Beispiele

### Beispiel 1: Alle Aufrufstellen einer Funktion finden
`pattern: "registerHandler\\("`, `output_mode: "content"` und `-C: 2` setzen, um die umgebenden Zeilen jedes Aufrufs zu sehen.

### Beispiel 2: Treffer über einen Typ hinweg zählen
`pattern: "TODO"`, `type: "py"` und `output_mode: "count"` setzen, um TODO-Summen pro Datei in Python-Quellen zu sehen.

### Beispiel 3: Mehrzeiliger Struct-Match
`pattern: "struct Config \\{[\\s\\S]*?version"` mit `multiline: true` verwenden, um ein Feld zu erfassen, das mehrere Zeilen tief in einem Go-Struct deklariert ist.

## Hinweise

- Bevorzugen Sie stets `Grep` gegenüber dem Ausführen von `grep` oder `rg` über `Bash`; das Tool ist auf korrekte Berechtigungen und strukturierte Ausgabe optimiert.
- Der Standard-Ausgabemodus ist `files_with_matches`, der günstigste. Wechseln Sie nur zu `content`, wenn Sie die Zeilen selbst sehen müssen.
- Kontext-Flags (`-A`, `-B`, `-C`) werden ignoriert, sofern `output_mode` nicht `content` ist.
- Große Ergebnismengen verbrauchen Kontext-Token. Nutzen Sie `head_limit`, `offset` oder strengere `glob`/`type`-Filter, um fokussiert zu bleiben.
- Für die Dateinamensfindung verwenden Sie stattdessen `Glob`; für offene Untersuchungen über viele Runden eine `Agent` mit dem Explore-Agenten entsenden.
