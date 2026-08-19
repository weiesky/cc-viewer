# Agent

Startet einen autonomen Claude-Code-Subagenten mit eigenem Kontextfenster, der eine fokussierte Aufgabe bearbeitet und ein einziges konsolidiertes Ergebnis zurückliefert. Dies ist der kanonische Mechanismus für die Delegation offener Recherchen, paralleler Arbeit oder Team-Zusammenarbeit.

## Wann verwenden

- Offene Suchen, bei denen noch nicht bekannt ist, welche Dateien relevant sind, und bei denen mehrere Runden von `Glob`, `Grep` und `Read` zu erwarten sind.
- Parallele, voneinander unabhängige Arbeit – mehrere Agenten in einer Nachricht starten, um separate Bereiche gleichzeitig zu untersuchen.
- Isolierung geräuschhafter Exploration vom Hauptdialog, damit der Elternkontext kompakt bleibt.
- Delegation an einen spezialisierten Subagenten-Typ wie `Explore`, `Plan`, `claude-code-guide` oder `statusline-setup`.
- Starten eines benannten Teammitglieds in einem aktiven Team für koordinierte Multi-Agenten-Arbeit.

NICHT verwenden, wenn die Zieldatei oder das Zielsymbol bereits bekannt ist – dann stattdessen direkt `Read`, `Grep` oder `Glob` nutzen. Eine einschrittige Suche über `Agent` verschwendet ein vollständiges Kontextfenster und erhöht die Latenz.

## Parameter

- `description` (string, erforderlich): Kurzes Label mit 3–5 Wörtern zur Beschreibung der Aufgabe; in UI und Logs sichtbar.
- `prompt` (string, erforderlich): Der vollständige, in sich abgeschlossene Auftrag, den der Agent ausführt. Muss allen nötigen Kontext, Einschränkungen und das erwartete Rückgabeformat enthalten.
- `subagent_type` (string, optional): Voreingestellte Persona wie `general-purpose`, `Explore`, `Plan`, `claude-code-guide` oder `statusline-setup`. Standard ist `general-purpose`.
- `run_in_background` (boolean, optional): Bei `true` läuft der Agent asynchron und die Elternsitzung kann weiterarbeiten; die Ergebnisse werden später abgerufen.
- `model` (string, optional): Überschreibt das Modell für diesen Agenten – `opus`, `sonnet` oder `haiku`. Standard ist das Modell der Elternsitzung.
- `isolation` (string, optional): Auf `worktree` setzen, um den Agenten in einem isolierten Git-Worktree laufen zu lassen, sodass dessen Dateisystem-Schreibvorgänge nicht mit dem Elternprozess kollidieren.
- `team_name` (string, optional): Beim Starten in ein bestehendes Team die Team-Kennung, der der Agent beitreten soll.
- `name` (string, optional): Adressierbarer Teammitgliedsname innerhalb des Teams, verwendet als `to`-Ziel für `SendMessage`.

## Beispiele

### Beispiel 1: Offene Code-Suche

```
Agent(
  description="Find auth middleware",
  subagent_type="Explore",
  prompt="Locate every place in this repo where JWT verification is performed. Return a bulleted list of absolute file paths with a one-line note about each site's role. Do not modify any files."
)
```

### Beispiel 2: Parallele, unabhängige Untersuchungen

Zwei Agenten in derselben Nachricht starten – einer inspiziert die Build-Pipeline, der andere überprüft das Test-Harness. Jeder erhält sein eigenes Kontextfenster und liefert eine Zusammenfassung zurück. Das Bündeln in einem einzigen Tool-Call-Block lässt sie gleichzeitig laufen.

### Beispiel 3: Teammitglied in ein laufendes Team starten

```
Agent(
  description="Data layer specialist",
  team_name="refactor-crew",
  name="db-lead",
  prompt="You are db-lead on team refactor-crew. Audit all Prisma schema files and propose a migration plan. Use SendMessage to report findings to the team leader."
)
```

## Hinweise

- Agenten haben kein Gedächtnis für frühere Durchläufe. Jeder Aufruf beginnt bei Null, der `prompt` muss daher vollständig in sich abgeschlossen sein – Dateipfade, Konventionen, Fragestellung und die exakte Form der gewünschten Antwort einbeziehen.
- Der Agent liefert genau eine finale Nachricht zurück. Er kann mitten im Lauf keine Rückfragen stellen, Unklarheiten im Prompt werden daher zu Rätselraten im Ergebnis.
- Mehrere Agenten parallel auszuführen ist deutlich schneller als sequenzielle Aufrufe, wenn die Teilaufgaben unabhängig sind. Diese in einem einzigen Tool-Call-Block bündeln.
- `isolation: "worktree"` verwenden, wenn ein Agent Dateien schreibt und Sie die Änderungen prüfen möchten, bevor sie in den Haupt-Working-Tree übernommen werden.
- `subagent_type: "Explore"` bevorzugen für Nur-Lese-Recherchen und `Plan` für Design-Arbeit; `general-purpose` ist der Standard für gemischte Lese-/Schreib-Aufgaben.
- Hintergrund-Agenten (`run_in_background: true`) eignen sich für langlaufende Jobs; kein Polling in einer Sleep-Schleife – der Elternprozess wird bei Abschluss benachrichtigt.
