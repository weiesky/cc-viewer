# TaskGet

## Definition

Ruft die vollständigen Details einer Aufgabe anhand ihrer ID ab.

## Parameter

| Parameter | Typ | Erforderlich | Beschreibung |
|-----------|-----|--------------|--------------|
| `taskId` | string | Ja | Die abzurufende Aufgaben-ID |

## Rückgabe

- `subject` — Aufgabentitel
- `description` — Detaillierte Anforderungen und Kontext
- `status` — Status: `pending`, `in_progress` oder `completed`
- `blocks` — Liste der Aufgaben, die von dieser Aufgabe blockiert werden
- `blockedBy` — Liste der Voraussetzungsaufgaben, die diese Aufgabe blockieren

## Anwendungsfälle

**Geeignet für:**
- Vollständige Beschreibung und Kontext einer Aufgabe vor Arbeitsbeginn abrufen
- Aufgabenabhängigkeiten verstehen
- Nach Aufgabenzuweisung vollständige Anforderungen abrufen

## Hinweise

- Nach dem Abrufen sollte die `blockedBy`-Liste geprüft werden, bevor mit der Arbeit begonnen wird
- TaskList verwenden, um Zusammenfassungen aller Aufgaben anzuzeigen

## Bedeutung in cc-viewer

TaskGet ist eine interne Aufgabenverwaltungsoperation und erzeugt keine eigenständige API-Anfrage.

## Originaltext

<textarea readonly>Use this tool to retrieve a task by its ID from the task list.

## When to Use This Tool

- When you need the full description and context before starting work on a task
- To understand task dependencies (what it blocks, what blocks it)
- After being assigned a task, to get complete requirements

## Output

Returns full task details:
- **subject**: Task title
- **description**: Detailed requirements and context
- **status**: 'pending', 'in_progress', or 'completed'
- **blocks**: Tasks waiting on this one to complete
- **blockedBy**: Tasks that must complete before this one can start

## Tips

- After fetching a task, verify its blockedBy list is empty before beginning work.
- Use TaskList to see all tasks in summary form.
</textarea>
