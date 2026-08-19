# Edit

Führt eine exakte String-Ersetzung in einer vorhandenen Datei durch. Dies ist der bevorzugte Weg zur Änderung von Dateien, da nur das Diff übertragen wird, was Edits präzise und nachvollziehbar hält.

## Wann verwenden

- Beheben eines Fehlers in einer einzelnen Funktion, ohne die umgebende Datei neu zu schreiben
- Aktualisieren eines Konfigurationswerts, Versionsstrings oder Import-Pfads
- Umbenennen eines Symbols innerhalb einer Datei mit `replace_all`
- Einfügen eines Blocks neben einem Anker (`old_string` erweitern, um umgebenden Kontext einzuschließen, und dann den Ersatztext angeben)
- Anwenden kleiner, klar abgegrenzter Edits im Rahmen eines mehrstufigen Refactorings

## Parameter

- `file_path` (string, erforderlich): Absoluter Pfad der zu ändernden Datei.
- `old_string` (string, erforderlich): Der exakte zu suchende Text. Muss zeichengenau übereinstimmen, einschließlich Leerraum und Einrückung.
- `new_string` (string, erforderlich): Der Ersatztext. Muss sich von `old_string` unterscheiden.
- `replace_all` (boolean, optional): Bei `true` wird jedes Vorkommen von `old_string` ersetzt. Standard ist `false`, was eine eindeutige Trefferstelle erfordert.

## Beispiele

### Beispiel 1: Einen einzelnen Aufrufort korrigieren
`old_string` auf die exakte Zeile `const port = 3000;` und `new_string` auf `const port = process.env.PORT ?? 3000;` setzen. Da der Treffer eindeutig ist, kann `replace_all` beim Standardwert bleiben.

### Beispiel 2: Ein Symbol innerhalb einer Datei umbenennen
Um `getUser` in `api.ts` überall in `fetchUser` umzubenennen, `old_string: "getUser"`, `new_string: "fetchUser"` und `replace_all: true` setzen.

### Beispiel 3: Ein mehrfach vorkommendes Snippet eindeutig machen
Falls `return null;` in mehreren Branches auftaucht, `old_string` um umgebenden Kontext erweitern (zum Beispiel die vorhergehende `if`-Zeile), damit der Treffer eindeutig ist. Andernfalls schlägt das Tool fehl, statt zu raten.

## Hinweise

- Sie müssen `Read` für die Datei in der aktuellen Sitzung mindestens einmal aufgerufen haben, bevor `Edit` Änderungen akzeptiert. Die Zeilennummern-Präfixe aus der `Read`-Ausgabe sind nicht Teil des Dateiinhalts; schließen Sie sie nicht in `old_string` oder `new_string` ein.
- Leerraum muss exakt übereinstimmen. Achten Sie auf Tabs versus Leerzeichen und nachgestellte Leerzeichen, besonders in YAML, Makefiles und Python.
- Wenn `old_string` nicht eindeutig ist und `replace_all` auf `false` steht, schlägt das Edit fehl. Entweder den Kontext erweitern oder `replace_all` aktivieren.
- Bevorzugen Sie `Edit` gegenüber `Write`, wenn die Datei bereits existiert; `Write` überschreibt die gesamte Datei und verliert unbeteiligten Inhalt, wenn nicht sorgfältig vorgegangen wird.
- Für mehrere voneinander unabhängige Edits in derselben Datei mehrere `Edit`-Aufrufe nacheinander absetzen, statt einer großen, fragilen Ersetzung.
- Vermeiden Sie das Einführen von Emojis, Marketing-Texten oder unerwünschten Dokumentationsblöcken beim Bearbeiten von Quelldateien.
