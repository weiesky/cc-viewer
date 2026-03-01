# TaskOutput

## Definition

Ruft die Ausgabe einer laufenden oder abgeschlossenen Hintergrundaufgabe ab. Geeignet für Hintergrund-Shells, asynchrone Agents und Remote-Sitzungen.

## Parameter

| Parameter | Typ | Erforderlich | Beschreibung |
|-----------|-----|--------------|--------------|
| `task_id` | string | Ja | Aufgaben-ID |
| `block` | boolean | Ja | Ob blockierend auf den Abschluss gewartet werden soll, Standard `true` |
| `timeout` | number | Ja | Maximale Wartezeit in Millisekunden, Standard 30000, maximal 600000 |

## Anwendungsfälle

**Geeignet für:**
- Fortschritt von über Task (`run_in_background: true`) gestarteten Hintergrund-Agents prüfen
- Ausführungsergebnisse von Hintergrund-Bash-Befehlen abrufen
- Auf den Abschluss asynchroner Aufgaben warten und Ausgabe abrufen

**Nicht geeignet für:**
- Vordergrundaufgaben – diese geben Ergebnisse direkt zurück, dieses Tool ist nicht erforderlich

## Hinweise

- `block: true` blockiert bis zum Abschluss der Aufgabe oder Timeout
- `block: false` für nicht-blockierende Statusprüfung
- Die Aufgaben-ID kann über den `/tasks`-Befehl gefunden werden
- Geeignet für alle Aufgabentypen: Hintergrund-Shells, asynchrone Agents, Remote-Sitzungen

## Bedeutung in cc-viewer

TaskOutput-Aufrufe erzeugen selbst keine API-Anfrage; es handelt sich um eine interne Aufgabenverwaltungsoperation von Claude Code, die nicht im Anfrage-Log erscheint.

## Originaltext

<textarea readonly>- Retrieves output from a running or completed task (background shell, agent, or remote session)
- Takes a task_id parameter identifying the task
- Returns the task output along with status information
- Use block=true (default) to wait for task completion
- Use block=false for non-blocking check of current status
- Task IDs can be found using the /tasks command
- Works with all task types: background shells, async agents, and remote sessions</textarea>
