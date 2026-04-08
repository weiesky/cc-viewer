# Panoramica degli strumenti di Claude Code

Claude Code fornisce al modello un set di strumenti integrati tramite il meccanismo tool_use dell'API Anthropic. L'array `tools` di ogni richiesta MainAgent contiene le definizioni JSON Schema complete di questi strumenti, e il modello li invoca tramite content block `tool_use` nella risposta.

Di seguito l'indice categorizzato di tutti gli strumenti.

## Sistema Agent

| Strumento | Scopo |
|------|------|
| [Task](Tool-Task.md) | Avvia un sub agent (SubAgent) per gestire task complessi multi-step |
| [TaskOutput](Tool-TaskOutput.md) | Ottieni l'output di un task in background |
| [TaskStop](Tool-TaskStop.md) | Ferma un task in background in esecuzione |
| [TaskCreate](Tool-TaskCreate.md) | Crea una voce nella lista dei task strutturata |
| [TaskGet](Tool-TaskGet.md) | Ottieni i dettagli di un task |
| [TaskUpdate](Tool-TaskUpdate.md) | Aggiorna lo stato, le dipendenze, ecc. di un task |
| [TaskList](Tool-TaskList.md) | Elenca tutti i task |

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

## Terminale

| Strumento | Scopo |
|------|------|
| [Bash](Tool-Bash.md) | Esegui comandi shell |

## Web

| Strumento | Scopo |
|------|------|
| [WebFetch](Tool-WebFetch.md) | Recupera contenuto web ed elaboralo con AI |
| [WebSearch](Tool-WebSearch.md) | Query su motore di ricerca |

## Pianificazione e interazione

| Strumento | Scopo |
|------|------|
| [EnterPlanMode](Tool-EnterPlanMode.md) | Entra in modalità pianificazione per progettare un piano di implementazione |
| [ExitPlanMode](Tool-ExitPlanMode.md) | Esci dalla modalità pianificazione e invia il piano per l'approvazione dell'utente |
| [AskUserQuestion](Tool-AskUserQuestion.md) | Poni domande all'utente per ottenere chiarimenti o decisioni |

## Estensioni

| Strumento | Scopo |
|------|------|
| [Skill](Tool-Skill.md) | Esegui una skill (slash command) |

## Integrazione IDE

| Strumento | Scopo |
|------|------|
| [getDiagnostics](Tool-getDiagnostics.md) | Ottieni informazioni diagnostiche del linguaggio da VS Code |
| [executeCode](Tool-executeCode.md) | Esegui codice nel kernel Jupyter |
