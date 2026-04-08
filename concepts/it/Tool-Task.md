# Task

> **Nota:** Nelle versioni più recenti di Claude Code, questo strumento è stato rinominato in **Agent**. Vedere il documento [Tool-Agent](Tool-Agent).

## Definizione

Avvia un sub agent (SubAgent) per gestire autonomamente task complessi multi-step. I sub agent sono sottoprocessi indipendenti, ciascuno con il proprio set di strumenti e contesto dedicati.

## Parametri

| Parametro | Tipo | Obbligatorio | Descrizione |
|------|------|------|------|
| `prompt` | string | Sì | Descrizione del task da eseguire per il sub agent |
| `description` | string | Sì | Breve riepilogo di 3-5 parole |
| `subagent_type` | string | Sì | Tipo di sub agent, determina il set di strumenti disponibili |
| `model` | enum | No | Specifica il modello (sonnet / opus / haiku), predefinito ereditato dal padre |
| `max_turns` | integer | No | Numero massimo di turni agentici |
| `run_in_background` | boolean | No | Se eseguire in background; i task in background restituiscono il percorso output_file |
| `resume` | string | No | ID dell'agent da riprendere, continua dall'ultima esecuzione |
| `isolation` | enum | No | Modalità di isolamento, `worktree` crea un git worktree temporaneo |

## Tipi di sub agent

| Tipo | Scopo | Strumenti disponibili |
|------|------|----------|
| `Bash` | Esecuzione comandi, operazioni git | Bash |
| `general-purpose` | Task multi-step generici | Tutti gli strumenti |
| `Explore` | Esplorazione rapida del codebase | Tutti gli strumenti tranne Task/Edit/Write/NotebookEdit/ExitPlanMode |
| `Plan` | Progettazione del piano di implementazione | Tutti gli strumenti tranne Task/Edit/Write/NotebookEdit/ExitPlanMode |
| `claude-code-guide` | Q&A sulla guida all'uso di Claude Code | Glob, Grep, Read, WebFetch, WebSearch |
| `statusline-setup` | Configurazione della barra di stato | Read, Edit |

## Scenari d'uso

**Adatto per:**
- Task complessi che richiedono il completamento autonomo in più step
- Esplorazione del codebase e ricerca approfondita (usando il tipo Explore)
- Lavoro parallelo che richiede ambienti isolati
- Task a lunga esecuzione che devono essere eseguiti in background

**Non adatto per:**
- Leggere un percorso file specifico — usare direttamente Read o Glob
- Cercare in 2-3 file noti — usare direttamente Read
- Cercare una definizione di classe specifica — usare direttamente Glob

## Note

- Al completamento, il sub agent restituisce un singolo messaggio; il suo risultato non è visibile all'utente e deve essere riportato dall'agent principale
- È possibile lanciare più chiamate Task in parallelo in un singolo messaggio per migliorare l'efficienza
- I task in background vengono monitorati tramite lo strumento TaskOutput
- Il tipo Explore è più lento delle chiamate dirette a Glob/Grep, usarlo solo quando la ricerca semplice non è sufficiente
