# TaskList

## Definition

Listet alle Aufgaben in der Aufgabenliste auf, um den Gesamtfortschritt und verfügbare Arbeit einzusehen.

## Parameter

Keine Parameter.

## Rückgabe

Zusammenfassung jeder Aufgabe:
- `id` — Aufgabenkennung
- `subject` — Kurzbeschreibung
- `status` — Status: `pending`, `in_progress` oder `completed`
- `owner` — Verantwortlicher (Agent-ID), leer bedeutet nicht zugewiesen
- `blockedBy` — Liste der unerledigten Aufgaben-IDs, die diese Aufgabe blockieren

## Anwendungsfälle

**Geeignet für:**
- Verfügbare Aufgaben anzeigen (Status pending, kein Owner, nicht blockiert)
- Gesamtfortschritt des Projekts prüfen
- Blockierte Aufgaben finden
- Nach Abschluss einer Aufgabe die nächste finden

## Hinweise

- Aufgaben bevorzugt in ID-Reihenfolge bearbeiten (niedrigste ID zuerst), da frühere Aufgaben oft Kontext für spätere liefern
- Aufgaben mit `blockedBy` können erst nach Auflösung der Abhängigkeiten übernommen werden
- TaskGet verwenden, um vollständige Details einer bestimmten Aufgabe abzurufen

## Bedeutung in cc-viewer

TaskList ist eine interne Aufgabenverwaltungsoperation und erzeugt keine eigenständige API-Anfrage.

## Originaltext

<textarea readonly>Use this tool to list all tasks in the task list.

## When to Use This Tool

- To see what tasks are available to work on (status: 'pending', no owner, not blocked)
- To check overall progress on the project
- To find tasks that are blocked and need dependencies resolved
- After completing a task, to check for newly unblocked work or claim the next available task
- **Prefer working on tasks in ID order** (lowest ID first) when multiple tasks are available, as earlier tasks often set up context for later ones

## Output

Returns a summary of each task:
- **id**: Task identifier (use with TaskGet, TaskUpdate)
- **subject**: Brief description of the task
- **status**: 'pending', 'in_progress', or 'completed'
- **owner**: Agent ID if assigned, empty if available
- **blockedBy**: List of open task IDs that must be resolved first (tasks with blockedBy cannot be claimed until dependencies resolve)

Use TaskGet with a specific task ID to view full details including description and comments.
</textarea>
