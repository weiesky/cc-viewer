# TaskList

## Definizione

Elenca tutti i task nella lista dei task, per visualizzare i progressi complessivi e il lavoro disponibile.

## Parametri

Nessun parametro.

## Contenuto restituito

Informazioni di riepilogo per ogni task:
- `id` — Identificatore del task
- `subject` — Breve descrizione
- `status` — Stato: `pending`, `in_progress` o `completed`
- `owner` — Responsabile (agent ID), vuoto se non assegnato
- `blockedBy` — Lista degli ID dei task non completati che bloccano questo task

## Scenari d'uso

**Adatto per:**
- Vedere quali task sono disponibili (stato pending, senza owner, non bloccati)
- Controllare i progressi complessivi del progetto
- Trovare task bloccati
- Trovare il prossimo task dopo averne completato uno

## Note

- Elaborare i task preferibilmente in ordine di ID (ID più basso per primo), poiché i task precedenti forniscono tipicamente contesto per quelli successivi
- I task con `blockedBy` non possono essere presi in carico finché le dipendenze non sono risolte
- Usare TaskGet per ottenere i dettagli completi di un task specifico

## Significato in cc-viewer

TaskList è un'operazione interna di gestione dei task, non genera richieste API indipendenti.

## Testo originale

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
