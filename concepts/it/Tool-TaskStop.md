# TaskStop

## Definizione

Ferma un task in background in esecuzione.

## Parametri

| Parametro | Tipo | Obbligatorio | Descrizione |
|------|------|------|------|
| `task_id` | string | No | ID del task in background da fermare |
| `shell_id` | string | No | Deprecato, usare `task_id` al suo posto |

## Scenari d'uso

**Adatto per:**
- Terminare task a lunga esecuzione non più necessari
- Annullare task in background avviati per errore

## Note

- Restituisce uno stato di successo o fallimento
- Il parametro `shell_id` è deprecato, usare `task_id`

## Significato in cc-viewer

La chiamata TaskStop non genera richieste API, è un'operazione interna di gestione dei task di Claude Code.

## Testo originale

<textarea readonly>
- Stops a running background task by its ID
- Takes a task_id parameter identifying the task to stop
- Returns a success or failure status
- Use this tool when you need to terminate a long-running task
</textarea>
