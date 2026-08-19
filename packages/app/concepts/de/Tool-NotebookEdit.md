# NotebookEdit

Ändert eine einzelne Zelle in einem Jupyter-Notebook (`.ipynb`). Unterstützt das Ersetzen der Zellenquelle, das Einfügen einer neuen Zelle oder das Löschen einer bestehenden Zelle, während die übrige Notebook-Struktur erhalten bleibt.

## Wann verwenden

- Korrigieren oder Aktualisieren einer Code-Zelle in einem Analyse-Notebook, ohne die gesamte Datei neu zu schreiben
- Austauschen einer Markdown-Zelle, um die Erzählung zu verbessern oder Dokumentation hinzuzufügen
- Einfügen einer neuen Code- oder Markdown-Zelle an einer bekannten Position in einem bestehenden Notebook
- Entfernen einer veralteten oder defekten Zelle, damit nachgeschaltete Zellen nicht mehr von ihr abhängen
- Vorbereiten eines reproduzierbaren Notebooks durch iteratives Bearbeiten einer Zelle nach der anderen

## Parameter

- `notebook_path` (string, erforderlich): Absoluter Pfad zur `.ipynb`-Datei. Relative Pfade werden abgelehnt.
- `new_source` (string, erforderlich): Die neue Zellenquelle. Für `replace` und `insert` wird sie der Zellenkörper; für `delete` wird sie ignoriert, ist aber im Schema dennoch erforderlich.
- `cell_id` (string, optional): ID der Zielzelle. In den Modi `replace` und `delete` wirkt das Tool auf diese Zelle. Im `insert`-Modus wird die neue Zelle unmittelbar nach der Zelle mit dieser ID eingefügt; weglassen, um ganz oben einzufügen.
- `cell_type` (enum, optional): Entweder `code` oder `markdown`. Erforderlich, wenn `edit_mode` `insert` ist. Beim Weglassen während `replace` wird der Typ der bestehenden Zelle beibehalten.
- `edit_mode` (enum, optional): `replace` (Standard), `insert` oder `delete`.

## Beispiele

### Beispiel 1: Eine fehlerhafte Code-Zelle ersetzen
`NotebookEdit` mit `notebook_path` als absolutem Pfad, `cell_id` als ID der Zielzelle und `new_source` mit dem korrigierten Python-Code aufrufen. `edit_mode` beim Standardwert `replace` belassen.

### Beispiel 2: Eine Markdown-Erklärung einfügen
Um eine Markdown-Zelle direkt nach einer bestehenden `setup`-Zelle hinzuzufügen, `edit_mode: "insert"`, `cell_type: "markdown"`, `cell_id` auf die ID der Setup-Zelle setzen und den Fließtext in `new_source` schreiben.

### Beispiel 3: Eine veraltete Zelle löschen
`edit_mode: "delete"` setzen und die `cell_id` der zu entfernenden Zelle angeben. Einen beliebigen String für `new_source` übergeben; er wird nicht angewendet.

## Hinweise

- Immer einen absoluten Pfad übergeben. `NotebookEdit` löst keine relativen Pfade gegen das Arbeitsverzeichnis auf.
- Das Tool schreibt nur die Zielzelle neu; Ausführungszähler, Outputs und Metadaten unbeteiligter Zellen bleiben unberührt.
- Ein Einfügen ohne `cell_id` platziert die neue Zelle ganz am Anfang des Notebooks.
- `cell_type` ist für Einfügungen zwingend. Bei Ersetzungen weglassen, sofern Sie nicht ausdrücklich eine Code-Zelle in Markdown umwandeln möchten oder umgekehrt.
- Um Zellen zu inspizieren und ihre IDs zu erhalten, verwenden Sie zunächst das `Read`-Tool auf dem Notebook; es liefert die Zellen mit Inhalt und Outputs zurück.
- Verwenden Sie das reguläre `Edit` für einfache Quelldateien; `NotebookEdit` ist spezifisch für `.ipynb`-JSON und versteht dessen Zellenstruktur.
