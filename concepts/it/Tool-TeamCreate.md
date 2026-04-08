# TeamCreate

## Definizione

Crea un nuovo team per coordinare più agent che lavorano su un progetto. I team permettono l'esecuzione parallela dei task tramite una lista di task condivisa e la messaggistica tra agent.

## Parametri

| Parametro | Tipo | Obbligatorio | Descrizione |
|-----------|------|--------------|-------------|
| `team_name` | string | Sì | Nome del nuovo team |
| `description` | string | No | Descrizione / scopo del team |
| `agent_type` | string | No | Tipo / ruolo del responsabile del team |

## Cosa viene creato

- **File di configurazione del team**: `~/.claude/teams/{team-name}/config.json` — memorizza la lista dei membri e i metadati
- **Directory della lista dei task**: `~/.claude/tasks/{team-name}/` — lista dei task condivisa per tutti i membri del team

I team hanno una corrispondenza 1:1 con le liste dei task.

## Flusso di lavoro del team

1. **TeamCreate** — creare il team e la sua lista dei task
2. **TaskCreate** — definire i task per il team
3. **Agent** (con `team_name` + `name`) — avviare i membri del team che si uniscono al team
4. **TaskUpdate** — assegnare i task ai membri tramite `owner`
5. I membri lavorano sui task e comunicano tramite **SendMessage**
6. Terminare i membri al completamento, poi **TeamDelete** per la pulizia

## Strumenti correlati

| Strumento | Scopo |
|-----------|-------|
| `TeamDelete` | Rimuovere il team e le directory dei task |
| `SendMessage` | Comunicazione tra agent all'interno del team |
| `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` | Gestire la lista dei task condivisa |
| `Agent` | Avviare i membri del team che si uniscono al team |
