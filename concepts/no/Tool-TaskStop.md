# TaskStop

## Definisjon

Stopper en bakgrunnsoppgave som kjører.

## Parametere

| Parameter | Type | Påkrevd | Beskrivelse |
|-----------|------|---------|-------------|
| `task_id` | string | Nei | ID-en til bakgrunnsoppgaven som skal stoppes |
| `shell_id` | string | Nei | Utfaset, bruk `task_id` i stedet |

## Bruksscenarioer

**Egnet for bruk:**
- Avslutte langvarige oppgaver som ikke lenger er nødvendige
- Avbryte bakgrunnsoppgaver som ble startet ved en feil

## Merknader

- Returnerer suksess- eller feilstatus
- `shell_id`-parameteren er utfaset, bruk `task_id`

## Betydning i cc-viewer

TaskStop-kall produserer ikke en API-forespørsel i seg selv; det er en intern oppgavebehandlingsoperasjon i Claude Code.

## Originaltekst

<textarea readonly>
- Stops a running background task by its ID
- Takes a task_id parameter identifying the task to stop
- Returns a success or failure status
- Use this tool when you need to terminate a long-running task
</textarea>
