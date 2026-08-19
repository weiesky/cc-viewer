# Panoramica degli strumenti di Claude Code

Claude Code fornisce al modello un set di strumenti integrati tramite il meccanismo tool_use dell'API Anthropic. L'array `tools` di ogni richiesta MainAgent contiene le definizioni JSON Schema complete di questi strumenti, e il modello li invoca tramite content block `tool_use` nella risposta.

Di seguito l'indice categorizzato di tutti gli strumenti.

## Sistema Agent

| Strumento | Scopo |
|------|------|
| [Agent](Tool-Agent.md) | Avvia un sub agent (SubAgent) per gestire task complessi multi-step |
| [TaskOutput](Tool-TaskOutput.md) | Ottieni l'output di un task in background |
| [TaskStop](Tool-TaskStop.md) | Ferma un task in background in esecuzione |
| [TaskCreate](Tool-TaskCreate.md) | Crea una voce nella lista dei task strutturata |
| [TaskGet](Tool-TaskGet.md) | Ottieni i dettagli di un task |
| [TaskUpdate](Tool-TaskUpdate.md) | Aggiorna lo stato, le dipendenze, ecc. di un task |
| [TaskList](Tool-TaskList.md) | Elenca tutti i task |
| [ListAgents](Tool-ListAgents.md) | Elenca gli agent disponibili nella sessione |

## Team & Orchestrazione

| Strumento | Scopo |
|------|------|
| [SendMessage](Tool-SendMessage.md) | Invia un messaggio a un altro agent |
| [Workflow](Tool-Workflow.md) | Esegui uno script di orchestrazione multi-agent deterministico |
| [Monitor](Tool-Monitor.md) | Trasmetti eventi da uno script a lunga esecuzione come notifiche |
| [SendFile](Tool-SendFile.md) | Invia file a un'altra sessione di Claude Code |
| [SendUserFile](Tool-SendUserFile.md) | Invia file all'utente |
| [SendUserMessage](Tool-SendUserMessage.md) | Invia un messaggio all'utente (tool legacy Brief) |
| [EndConversation](Tool-EndConversation.md) | Termina la conversazione corrente |

## Operazioni sui file

| Strumento | Scopo |
|------|------|
| [Read](Tool-Read.md) | Leggi il contenuto di un file (supporta testo, immagini, PDF, Jupyter notebook) |
| [Edit](Tool-Edit.md) | Modifica un file tramite sostituzione esatta di stringhe |
| [Write](Tool-Write.md) | Scrivi o sovrascrivi un file |
| [NotebookEdit](Tool-NotebookEdit.md) | Modifica celle di Jupyter notebook |

## Ricerca

| Strumento | Scopo |
|------|------|
| [Glob](Tool-Glob.md) | Cerca file per pattern di nome file |
| [Grep](Tool-Grep.md) | Ricerca nel contenuto dei file basata su ripgrep |
| [ToolSearch](Tool-ToolSearch.md) | Cerca e carica strumenti differiti/MCP su richiesta |

## Terminale

| Strumento | Scopo |
|------|------|
| [Bash](Tool-Bash.md) | Esegui comandi shell |
| [REPL](Tool-REPL.md) | Esegui JavaScript in un REPL Node.js persistente |

## Web

| Strumento | Scopo |
|------|------|
| [WebFetch](Tool-WebFetch.md) | Recupera contenuto web ed elaboralo con AI |
| [WebSearch](Tool-WebSearch.md) | Query su motore di ricerca |
| [Artifact](Tool-Artifact.md) | Pubblica un file HTML/Markdown come pagina web ospitata su claude.ai |
| [DesignSync](Tool-DesignSync.md) | Sincronizza una libreria di componenti locale con un progetto di design system di claude.ai |

## Pianificazione e interazione

| Strumento | Scopo |
|------|------|
| [EnterPlanMode](Tool-EnterPlanMode.md) | Entra in modalità pianificazione per progettare un piano di implementazione |
| [ExitPlanMode](Tool-ExitPlanMode.md) | Esci dalla modalità pianificazione e invia il piano per l'approvazione dell'utente |
| [AskUserQuestion](Tool-AskUserQuestion.md) | Poni domande all'utente per ottenere chiarimenti o decisioni |
| [ReportFindings](Tool-ReportFindings.md) | Segnala i risultati della revisione del codice come lista tipata per l'UI host |
| [TodoWrite](Tool-TodoWrite.md) | Scrivi una lista todo strutturata per la sessione |
| [SendFeedback](Tool-SendFeedback.md) | Invia feedback strutturato su Claude Code ad Anthropic |
| [Projects](Tool-Projects.md) | Gestisci i documenti della knowledge base di progetto |
| [ProposeGoal](Tool-ProposeGoal.md) | Proponi un obiettivo di completamento verificabile per la sessione |

## Worktrees

| Strumento | Scopo |
|------|------|
| [EnterWorktree](Tool-EnterWorktree.md) | Crea o accedi a un worktree git isolato per la sessione |
| [ExitWorktree](Tool-ExitWorktree.md) | Esci dalla sessione worktree, mantenendola o rimuovendola |

## Pianificazione e Notifiche

| Strumento | Scopo |
|------|------|
| [CronCreate](Tool-CronCreate.md) | Pianifica una richiesta su un'espressione cron (ricorrente o una volta) |
| [CronDelete](Tool-CronDelete.md) | Annulla un job cron pianificato |
| [CronList](Tool-CronList.md) | Elenca i job cron pianificati |
| [ScheduleWakeup](Tool-ScheduleWakeup.md) | Auto-ritmo le iterazioni /loop pianificando il prossimo risveglio |
| [PushNotification](Tool-PushNotification.md) | Invia una notifica desktop/mobile all'utente |
| [RemoteTrigger](Tool-RemoteTrigger.md) | Gestisci le routine di remote-trigger di claude.ai |
| [ReadNotifications](Tool-ReadNotifications.md) | Leggi le notifiche in attesa della sessione |

## Estensioni

| Strumento | Scopo |
|------|------|
| [Skill](Tool-Skill.md) | Esegui una skill (slash command) |

## MCP ed estensioni

| Strumento | Scopo |
|------|------|
| [ListMcpResources](Tool-ListMcpResources.md) | Elenca le risorse esposte dai server MCP connessi |
| [ReadMcpResource](Tool-ReadMcpResource.md) | Leggi una singola risorsa di un server MCP tramite URI |
| [ReadMcpResourceDir](Tool-ReadMcpResourceDir.md) | Elenca una risorsa MCP in stile directory tramite URI |
| [SearchMcpRegistry](Tool-SearchMcpRegistry.md) | Cerca nel registry dei connector MCP per parola chiave |
| [SuggestConnectors](Tool-SuggestConnectors.md) | Risolvi i dettagli dei connector dai risultati di ricerca del registry |
| [ListConnectors](Tool-ListConnectors.md) | Elenca i connector MCP installati |
| [SuggestPluginInstall](Tool-SuggestPluginInstall.md) | Mostra una scheda inline di installazione di plugin |
| [SuggestSkills](Tool-SuggestSkills.md) | Mostra una scheda di skill aggiungibili |
| [ListPlugins](Tool-ListPlugins.md) | Elenca i plugin claude.ai abilitati |
| [ListSkills](Tool-ListSkills.md) | Elenca le skill claude.ai abilitate |

## Integrazione IDE

| Strumento | Scopo |
|------|------|
| [LSP](Tool-LSP.md) | Query del language server (definizioni, riferimenti, simboli) |
