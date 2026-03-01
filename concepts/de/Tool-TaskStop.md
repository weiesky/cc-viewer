# TaskStop

## Definition

Stoppt eine laufende Hintergrundaufgabe.

## Parameter

| Parameter | Typ | Erforderlich | Beschreibung |
|-----------|-----|--------------|--------------|
| `task_id` | string | Nein | ID der zu stoppenden Hintergrundaufgabe |
| `shell_id` | string | Nein | Veraltet, stattdessen `task_id` verwenden |

## Anwendungsfälle

**Geeignet für:**
- Nicht mehr benötigte lang laufende Aufgaben beenden
- Versehentlich gestartete Hintergrundaufgaben abbrechen

## Hinweise

- Gibt Erfolgs- oder Fehlerstatus zurück
- Der `shell_id`-Parameter ist veraltet; `task_id` verwenden

## Bedeutung in cc-viewer

TaskStop-Aufrufe erzeugen selbst keine API-Anfrage und gehören zu den internen Aufgabenverwaltungsoperationen von Claude Code.

## Originaltext

<textarea readonly>
- Stops a running background task by its ID
- Takes a task_id parameter identifying the task to stop
- Returns a success or failure status
- Use this tool when you need to terminate a long-running task
</textarea>
