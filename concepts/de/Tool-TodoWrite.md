# TodoWrite

Schreibt eine strukturierte Aufgabenliste für die aktuelle Sitzung und ersetzt dabei die vorherige Liste. Jeder Eintrag trägt seinen Text, einen Status und eine Verlaufsform, die in Fortschrittsanzeigen dargestellt wird.

## Wann verwenden

- Eine Aufgabe hat mehrere klar unterscheidbare Schritte, und ihre Nachverfolgung hilft Ihnen (und dem Benutzer), den Fortschritt zu sehen.
- Der Benutzer bittet ausdrücklich um eine Aufgabenliste.
- Sie möchten genau einen Eintrag als in Bearbeitung markieren, während die übrigen ausstehend oder abgeschlossen bleiben.

## Parameter

- `todos` (array, erforderlich): Die vollständige aktualisierte Aufgabenliste. Jeder Eintrag hat:
  - `content` (string): Die Aufgabenbeschreibung.
  - `status` (string): Einer von `pending`, `in_progress`, `completed`.
  - `activeForm` (string): Verlaufsform-Text, der angezeigt wird, während der Eintrag in Bearbeitung ist (z. B. "Running tests").

## Beispiele

### Beispiel 1: Einen dreistufigen Änderungsvorgang nachverfolgen

```
TodoWrite(
  todos=[
    {content="Update the parser", status="in_progress", activeForm="Updating the parser"},
    {content="Add unit tests", status="pending", activeForm="Adding unit tests"},
    {content="Run the full test suite", status="pending", activeForm="Running the full test suite"}
  ]
)
```

Die gesamte Liste wird bei jedem Aufruf neu geschrieben – schließen Sie immer alle Einträge ein, nicht nur die geänderten.

## Hinweise

- Die Liste wird bei jedem Aufruf vollständig ersetzt; um einen Eintrag zu aktualisieren, reichen Sie jeden Eintrag mit dem neuen Status erneut ein.
- Halten Sie jeweils genau einen Eintrag auf `in_progress`.
- In Sitzungen, in denen die strukturierten Aufgaben-Tools (`TaskCreate`/`TaskUpdate`/`TaskList`) aktiviert sind, bietet der Harness möglicherweise diese anstelle von `TodoWrite` an – bevorzugen Sie das jeweils angekündigte Tool-Set.
