# TaskList

## Definisjon

Lister alle oppgaver i oppgavelisten for å se samlet fremdrift og tilgjengelig arbeid.

## Parametere

Ingen parametere.

## Returnert innhold

Sammendragsinformasjon for hver oppgave:
- `id` — Oppgaveidentifikator
- `subject` — Kort beskrivelse
- `status` — Status: `pending`, `in_progress` eller `completed`
- `owner` — Ansvarlig (agent-ID), tom betyr ikke tildelt
- `blockedBy` — Liste over uferdige oppgave-ID-er som blokkerer denne oppgaven

## Bruksscenarioer

**Egnet for bruk:**
- Se hvilke oppgaver som er tilgjengelige (status pending, ingen owner, ikke blokkert)
- Sjekke samlet prosjektfremdrift
- Finne blokkerte oppgaver
- Finne neste oppgave etter å ha fullført en

## Merknader

- Foretrekk å behandle oppgaver i ID-rekkefølge (lavest ID først), da tidlige oppgaver vanligvis gir kontekst for senere oppgaver
- Oppgaver med `blockedBy` kan ikke tas før avhengigheten er løst
- Bruk TaskGet for å hente fullstendige detaljer for en spesifikk oppgave

## Betydning i cc-viewer

TaskList er en intern oppgavebehandlingsoperasjon og produserer ikke en selvstendig API-forespørsel.

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
