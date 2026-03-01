# TaskOutput

## Definisjon

Henter utdata fra bakgrunnsoppgaver som kjører eller er fullført. Gjelder for bakgrunns-shell, asynkrone agenter og fjernsesjoner.

## Parametere

| Parameter | Type | Påkrevd | Beskrivelse |
|-----------|------|---------|-------------|
| `task_id` | string | Ja | Oppgave-ID |
| `block` | boolean | Ja | Om den skal blokkere og vente til oppgaven er ferdig, standard `true` |
| `timeout` | number | Ja | Maksimal ventetid (millisekunder), standard 30000, maks 600000 |

## Bruksscenarioer

**Egnet for bruk:**
- Sjekke fremdriften til bakgrunnsagenter startet via Task (`run_in_background: true`)
- Hente resultater fra bakgrunns-Bash-kommandoer
- Vente på at asynkrone oppgaver fullføres og hente utdata

**Ikke egnet for bruk:**
- Forgrunnsoppgaver — disse returnerer resultater direkte, dette verktøyet er ikke nødvendig

## Merknader

- `block: true` blokkerer til oppgaven er ferdig eller tidsavbruddet nås
- `block: false` for ikke-blokkerende sjekk av gjeldende status
- Oppgave-ID kan finnes via `/tasks`-kommandoen
- Gjelder for alle oppgavetyper: bakgrunns-shell, asynkrone agenter, fjernsesjoner

## Betydning i cc-viewer

TaskOutput-kall produserer ikke en API-forespørsel i seg selv; det er en intern oppgavebehandlingsoperasjon i Claude Code og vises ikke i forespørselsloggen.

## Originaltekst

<textarea readonly>- Retrieves output from a running or completed task (background shell, agent, or remote session)
- Takes a task_id parameter identifying the task
- Returns the task output along with status information
- Use block=true (default) to wait for task completion
- Use block=false for non-blocking check of current status
- Task IDs can be found using the /tasks command
- Works with all task types: background shells, async agents, and remote sessions</textarea>
