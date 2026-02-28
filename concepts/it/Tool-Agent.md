# Agent

## Definizione

Avvia un sub agent (SubAgent) per gestire autonomamente task complessi multi-step. I sub agent sono sottoprocessi indipendenti, ciascuno con il proprio set di strumenti e contesto dedicati. Agent è la versione rinominata dello strumento Task nelle versioni più recenti di Claude Code.

## Parametri

| Parametro | Tipo | Obbligatorio | Descrizione |
|------|------|------|------|
| `prompt` | string | Sì | Descrizione del task da eseguire per il sub agent |
| `description` | string | Sì | Breve riepilogo di 3-5 parole |
| `subagent_type` | string | Sì | Tipo di sub agent, determina il set di strumenti disponibili |
| `model` | enum | No | Specifica il modello (sonnet / opus / haiku), predefinito ereditato dal padre |
| `max_turns` | integer | No | Numero massimo di turni agentici |
| `run_in_background` | boolean | No | Se eseguire in background; i task in background restituiscono il percorso output_file |
| `resume` | string | No | ID dell'agent da riprendere, continua dall'ultima esecuzione. Utile per riprendere un sub agent precedente senza perdere il contesto |
| `isolation` | enum | No | Modalità di isolamento, `worktree` crea un git worktree temporaneo |

## Tipi di sub agent

| Tipo | Scopo | Strumenti disponibili |
|------|------|----------|
| `Bash` | Esecuzione comandi, operazioni git | Bash |
| `general-purpose` | Task multi-step generici | Tutti gli strumenti |
| `Explore` | Esplorazione rapida del codebase | Tutti gli strumenti tranne Agent/Edit/Write/NotebookEdit/ExitPlanMode |
| `Plan` | Progettazione del piano di implementazione | Tutti gli strumenti tranne Agent/Edit/Write/NotebookEdit/ExitPlanMode |
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
- È possibile lanciare più chiamate Agent in parallelo in un singolo messaggio per migliorare l'efficienza
- I task in background vengono monitorati tramite lo strumento TaskOutput
- Il tipo Explore è più lento delle chiamate dirette a Glob/Grep, usarlo solo quando la ricerca semplice non è sufficiente
- Usare `run_in_background: true` per task a lunga esecuzione che non necessitano di risultati immediati; usare la modalità in primo piano (predefinita) quando il risultato è necessario prima di procedere
- Il parametro `resume` consente di continuare una sessione di sub agent avviata in precedenza, preservando il contesto accumulato

## Significato in cc-viewer

Agent è il nuovo nome dello strumento Task nelle versioni recenti di Claude Code. Le chiamate Agent generano catene di richieste SubAgent, visibili nella lista delle richieste come sequenze di sotto-richieste indipendenti dal MainAgent. Le richieste SubAgent hanno tipicamente un system prompt semplificato e meno definizioni di strumenti, in netto contrasto con il MainAgent. In cc-viewer, possono apparire i nomi strumento `Task` o `Agent` a seconda della versione di Claude Code utilizzata nella conversazione registrata.
