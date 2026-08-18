# LSP

Fragt Language-Server-Protocol-(LSP-)Server nach Code-Intelligenz ab — Definitionen, Referenzen, Hover-Informationen, Symbole, Implementierungen und Aufrufhierarchie. Präziser als eine Textsuche, weil es Code semantisch versteht.

## Wann verwenden

- Zur Definition eines Symbols springen (`goToDefinition`) oder jede Referenz finden (`findReferences`)
- Typsignaturen / Dokumentation für ein Symbol lesen (`hover`)
- Symbole in einer Datei auflisten (`documentSymbol`) oder projektweit danach suchen (`workspaceSymbol`)
- Implementierungen einer Schnittstelle oder abstrakten Methode finden (`goToImplementation`)
- Die Aufrufhierarchie einer Funktion durchlaufen (`prepareCallHierarchy`, `incomingCalls`, `outgoingCalls`)

## Aktivierung

- Inaktiv, bis ein Code-Intelligenz-Plugin für die Sprache installiert ist (das Server-Binary wird separat installiert).
- Das Tool erscheint nur, wenn ein LSP-Client verbunden ist.

## Parameter

- `operation` (string, erforderlich): eine der oben aufgeführten Operationen.
- `filePath` (string, erforderlich): die zu bearbeitende Datei.
- `line` (number, erforderlich): 1-basierte Zeilennummer, wie im Editor angezeigt.
- `character` (number, erforderlich): 1-basierter Zeichenoffset, wie im Editor angezeigt.

## Hinweise

- Erfordert einen konfigurierten LSP-Server für diesen Dateityp; andernfalls gibt der Aufruf einen Fehler zurück.
- Zeile und Zeichen sind 1-basiert (Editor-Koordinaten), nicht 0-basiert.
- Bevorzuge LSP gegenüber `Grep`, wenn du semantische Navigation (echte Definition/Referenz) statt einer textuellen Übereinstimmung benötigst.

## Verwandte Konzepte

- Ergänzt `Read` und `Edit` beim Navigieren und Ändern von Code.
