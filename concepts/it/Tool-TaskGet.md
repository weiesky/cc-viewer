# TaskGet

## Definizione

Ottiene i dettagli completi di un task tramite il suo ID.

## Parametri

| Parametro | Tipo | Obbligatorio | Descrizione |
|------|------|------|------|
| `taskId` | string | Sì | ID del task da ottenere |

## Contenuto restituito

- `subject` — Titolo del task
- `description` — Requisiti dettagliati e contesto
- `status` — Stato: `pending`, `in_progress` o `completed`
- `blocks` — Lista dei task bloccati da questo task
- `blockedBy` — Lista dei task prerequisiti che bloccano questo task

## Scenari d'uso

**Adatto per:**
- Ottenere la descrizione completa e il contesto di un task prima di iniziare il lavoro
- Comprendere le dipendenze del task
- Ottenere i requisiti completi dopo essere stati assegnati a un task

## Note

- Dopo aver ottenuto il task, verificare che la lista `blockedBy` sia vuota prima di iniziare il lavoro
- Usare TaskList per visualizzare il riepilogo di tutti i task

## Significato in cc-viewer

TaskGet è un'operazione interna di gestione dei task, non genera richieste API indipendenti.

## Testo originale

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
