# TaskList

## Definition

Lister alle opgaver i opgavelisten for at se den samlede fremdrift og tilgængeligt arbejde.

## Parametre

Ingen parametre.

## Returneret indhold

Resuméinformation for hver opgave:
- `id` — Opgaveidentifikator
- `subject` — Kort beskrivelse
- `status` — Status: `pending`, `in_progress` eller `completed`
- `owner` — Ansvarlig (agent-ID), tom betyder ikke tildelt
- `blockedBy` — Liste over ID'er for ufuldførte opgaver der blokerer denne opgave

## Brugsscenarier

**Egnet til:**
- Se hvilke opgaver der er tilgængelige (status pending, ingen owner, ikke blokeret)
- Kontrollere projektets samlede fremdrift
- Finde blokerede opgaver
- Finde den næste opgave efter at have fuldført en

## Bemærkninger

- Behandl opgaver fortrinsvis i ID-rækkefølge (laveste ID først), da tidlige opgaver typisk giver kontekst til efterfølgende opgaver
- Opgaver med `blockedBy` kan ikke påtages, før afhængighederne er løst
- Brug TaskGet til at hente komplette detaljer for en specifik opgave

## Betydning i cc-viewer

TaskList er en intern opgavestyringsoperation og genererer ikke selvstændige API-requests.

## Originaltekst

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
