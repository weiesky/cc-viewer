# TaskStop

## Definition

Stopper en kørende baggrundsopgave.

## Parametre

| Parameter | Type | Påkrævet | Beskrivelse |
|------|------|------|------|
| `task_id` | string | Nej | ID på baggrundsopgaven der skal stoppes |
| `shell_id` | string | Nej | Forældet, brug `task_id` i stedet |

## Brugsscenarier

**Egnet til:**
- Afslutte langvarige opgaver der ikke længere er nødvendige
- Annullere fejlagtigt startede baggrundsopgaver

## Bemærkninger

- Returnerer en succes- eller fejlstatus
- Parameteren `shell_id` er forældet, brug `task_id`

## Betydning i cc-viewer

TaskStop-kald genererer ikke API-requests; det er en intern opgavestyringsoperation i Claude Code.

## Originaltekst

<textarea readonly>
- Stops a running background task by its ID
- Takes a task_id parameter identifying the task to stop
- Returns a success or failure status
- Use this tool when you need to terminate a long-running task
</textarea>
