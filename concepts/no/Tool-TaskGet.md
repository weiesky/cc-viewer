# TaskGet

## Definisjon

Henter fullstendige detaljer for en oppgave via oppgave-ID.

## Parametere

| Parameter | Type | Påkrevd | Beskrivelse |
|-----------|------|---------|-------------|
| `taskId` | string | Ja | ID-en til oppgaven som skal hentes |

## Returnert innhold

- `subject` — Oppgavetittel
- `description` — Detaljerte krav og kontekst
- `status` — Status: `pending`, `in_progress` eller `completed`
- `blocks` — Liste over oppgaver blokkert av denne oppgaven
- `blockedBy` — Liste over forutgående oppgaver som blokkerer denne oppgaven

## Bruksscenarioer

**Egnet for bruk:**
- Hente fullstendig beskrivelse og kontekst før arbeidet starter
- Forstå oppgavens avhengighetsforhold
- Hente fullstendige krav etter å ha blitt tildelt en oppgave

## Merknader

- Etter å ha hentet oppgaven bør du sjekke at `blockedBy`-listen er tom før du starter arbeidet
- Bruk TaskList for å se sammendragsinformasjon for alle oppgaver

## Betydning i cc-viewer

TaskGet er en intern oppgavebehandlingsoperasjon og produserer ikke en selvstendig API-forespørsel.

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
