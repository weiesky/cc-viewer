# variabili di systemPromptModel.md

Questo file documenta solo le variabili in `systemPromptModel.md` che devono essere risolte in fase di esecuzione. Ogni variabile foglia si risolve in una stringa, un numero o una stringa vuota `""`; quando non è possibile ottenere un valore, torna uniformemente a una stringa vuota.

## Spazio di lavoro e ambiente utente

| Variable | Description | Example |
|---|---|---|
| `${environment.cwd}` | Attuale directory di lavoro principale. | `/Users/sky/claude-code` |
| `${environment.originalCwd}` | Directory di lavoro originale all'avvio del processo/sessione. | `/Users/sky/claude-code` |
| `${environment.home}` | Directory home dell'utente, utilizzata per risolvere `~`. | `/Users/sky` |
| `${environment.user}` | Nome utente del sistema corrente. | `sky` |
| `${environment.workspaceRoots}` | Radici dello spazio di lavoro per la sessione attuale; può essere renderizzato come una stringa separata da interruzioni di riga. | `/Users/sky/claude-code` |
| `${environment.path}` | PATH del processo corrente. | `/opt/homebrew/bin:/usr/bin:/bin` |
| `${environment.lang}` | Impostazioni locali correnti o ambiente linguistico. | `zh_CN.UTF-8` |

## Sistema operativo

| Variable | Description | Example |
|---|---|---|
| `${os.platform}` | Piattaforma identificata da Node.js. | `darwin` |
| `${os.type}` | Tipo di sistema operativo. | `Darwin` |
| `${os.arch}` | Architettura della CPU. | `arm64` |
| `${os.shell}` | Shell corrente. | `/bin/zsh` |
| `${os.version}` | Descrizione della versione del sistema operativo. | `Darwin Kernel Version ...` |
| `${os.release}` | Release del sistema operativo. | `24.5.0` |
| `${os.hostname}` | Hostname corrente. | `MacBook-Pro.local` |
| `${os.availableParallelism}` | Parallelismo disponibile. | `10` |
| `${os.totalMemory}` | Memoria totale del sistema, in byte. | `34359738368` |
| `${os.freeMemory}` | Memoria libera, in byte. | `8589934592` |
| `${os.uptime}` | Tempo di attività del sistema, in secondi. | `123456` |

## Runtime di Node.js

| Variable | Description | Example |
|---|---|---|
| `${runtime.nodeVersion}` | Versione di Node.js corrente. | `v24.14.0` |
| `${runtime.execPath}` | Percorso dell'eseguibile Node.js corrente. | `/opt/homebrew/bin/node` |
| `${runtime.pid}` | ID del processo corrente. | `12345` |
| `${runtime.ppid}` | ID del processo padre. | `1234` |

## Ora

| Variable | Description | Example |
|---|---|---|
| `${time.current}` | Stringa di ora locale corrente. | `Thu Jul 09 2026 18:22:09 GMT+0800 (China Standard Time)` |
| `${time.iso}` | Ora ISO corrente. | `2026-07-09T10:22:09.000Z` |
| `${time.date}` | Data locale corrente. | `2026-07-09` |
| `${time.timezone}` | Fuso orario del sistema corrente. | `Asia/Shanghai` |

## Autorizzazioni e sandbox

| Variable | Description | Example |
|---|---|---|
| `${permissions.mode}` | Modalità di autorizzazione dello strumento corrente. | `default` |
| `${permissions.approvalsReviewer}` | Criterio di approvazione corrente o modalità di revisione. | `auto_review` |
| `${sandbox.mode}` | Modalità sandbox del sistema file. | `workspace-write` |
| `${sandbox.networkAccess}` | Stato dell'accesso di rete. | `enabled` |
| `${sandbox.writableRoots}` | Directory in cui la sandbox consente la scrittura; può essere renderizzato come una stringa separata da interruzioni di riga. | `/Users/sky/Documents/Playground` |

## Terminale

| Variable | Description | Example |
|---|---|---|
| `${terminal.term}` | TERM corrente. | `xterm-256color` |
| `${terminal.colorTerm}` | COLORTERM corrente. | `truecolor` |
| `${terminal.columns}` | Numero di colonne del terminale corrente. | `120` |
| `${terminal.rows}` | Numero di righe del terminale corrente. | `40` |

## File system

| Variable | Description | Example |
|---|---|---|
| `${filesystem.tmpdir}` | Directory temporanea del sistema. | `/var/folders/.../T` |
| `${filesystem.pathSeparator}` | Separatore del percorso file. | `/` |
| `${filesystem.pathDelimiter}` | Delimitatore della voce PATH. | `:` |

## Modello

| Variable | Description | Example |
|---|---|---|
| `${model.name}` | Nome o ID del modello corrente. | `claude-opus-4-6` |
| `${model.knowledgeCutoff}` | Limite di conoscenza del modello corrente; questo valore non può essere derivato dal sistema operativo e deve essere iniettato tramite configurazione esterna o un override. | `May 2025` |

## Git

| Variable | Description | Example |
|---|---|---|
| `${git.isRepository}` | Se la directory corrente si trova all'interno di un repository Git, come stringa. | `true` |
| `${git.root}` | Directory radice del repository Git. | `/Users/sky/project` |
| `${git.branch}` | Branch Git corrente o hash HEAD breve. | `main` |
| `${git.mainBranch}` | Branch principale predefinito, normalmente utilizzato come destinazione di PR o merge. | `main` |
| `${git.userName}` | Attuale Git `user.name`. | `Sky` |
| `${git.status}` | Output di `git status --short`. | `M src/index.ts` |
| `${git.recentCommits}` | Riepilogo dei commit recenti. | `abc1234 Fix prompt builder` |

## Memoria

Le variabili di memoria descrivono la directory della memoria persistente basata su file. `${memory.dir}` viene risolto dall'override `CC_MEMORY_DIR` / `CLAUDE_MEMORY_DIR` quando impostato; in caso contrario, viene calcolato come `<home>/.claude/projects/<slug>/memory/`, dove `<slug>` è la directory di lavoro principale con ogni carattere non alfanumerico sostituito da `-`. `${memory.index}` contiene il contenuto di `MEMORY.md` in quella directory (l'indice caricato ogni sessione), e `${memory.enabled}` indica se la memoria è disponibile. Le sezioni `# Memory` e `# Memory index` vengono assemblate solo quando la memoria è abilitata.

| Variable | Description | Example |
|---|---|---|
| `${memory.dir}` | Directory della memoria risolta. | `/Users/sky/.claude/projects/-Users-sky-project/memory/` |
| `${memory.index}` | Contenuto di `MEMORY.md`, o `""` quando assente. | `# Memory index\n- [Commit to main](commit-to-main.md) — hook` |
| `${memory.enabled}` | Se la memoria è disponibile, come stringa. | `true` |

## Scratchpad

La directory scratchpad è specifica della sessione e non può essere derivata dal sistema operativo; deve essere iniettata tramite l'override `CC_SCRATCHPAD_DIR` / `CLAUDE_SCRATCHPAD_DIR`. Se non impostato, torna a `""`, e la sezione `# Scratchpad Directory` viene omessa dall'assemblaggio.

| Variable | Description | Example |
|---|---|---|
| `${scratchpad.dir}` | Directory temporanea specifica della sessione. | `/private/tmp/claude-501/<slug>/<session>/scratchpad` |
