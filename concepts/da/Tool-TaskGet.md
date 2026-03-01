# TaskGet

## Definition

Henter de komplette detaljer for en opgave via dens ID.

## Parametre

| Parameter | Type | Påkrævet | Beskrivelse |
|------|------|------|------|
| `taskId` | string | Ja | ID på opgaven der skal hentes |

## Returneret indhold

- `subject` — Opgavetitel
- `description` — Detaljerede krav og kontekst
- `status` — Status: `pending`, `in_progress` eller `completed`
- `blocks` — Liste over opgaver blokeret af denne opgave
- `blockedBy` — Liste over forudgående opgaver der blokerer denne opgave

## Brugsscenarier

**Egnet til:**
- Hente den komplette beskrivelse og kontekst for en opgave, før arbejdet påbegyndes
- Forstå opgavens afhængigheder
- Hente komplette krav efter at være blevet tildelt en opgave

## Bemærkninger

- Efter hentning af opgaven bør man kontrollere, at `blockedBy`-listen er tom, før arbejdet påbegyndes
- Brug TaskList til at se resuméinformation for alle opgaver

## Betydning i cc-viewer

TaskGet er en intern opgavestyringsoperation og genererer ikke selvstændige API-requests.

## Originaltekst

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
