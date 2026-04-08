# TeamDelete

## Definizione

Rimuove un team e le relative directory dei task quando il lavoro di collaborazione multi-agent è completato. È la controparte di pulizia di TeamCreate.

## Comportamento

- Rimuove la directory del team: `~/.claude/teams/{team-name}/`
- Rimuove la directory della lista dei task: `~/.claude/tasks/{team-name}/`
- Cancella il contesto del team dalla sessione corrente

**Importante**: TeamDelete fallirà se il team ha ancora membri attivi. I membri del team devono prima essere terminati correttamente tramite richieste di shutdown di SendMessage.

## Utilizzo tipico

TeamDelete viene chiamato alla fine di un flusso di lavoro del team:

1. Tutti i task sono completati
2. I membri del team vengono terminati tramite `SendMessage` con `shutdown_request`
3. **TeamDelete** rimuove le directory del team e dei task

## Strumenti correlati

| Strumento | Scopo |
|-----------|-------|
| `TeamCreate` | Creare un nuovo team e la sua lista dei task |
| `SendMessage` | Comunicare con i membri del team / inviare richieste di shutdown |
| `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` | Gestire la lista dei task condivisa |
| `Agent` | Avviare i membri del team che si uniscono al team |
