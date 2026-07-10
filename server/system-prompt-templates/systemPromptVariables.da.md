# systemPromptModel.md variabler

Denne fil dokumenterer kun variablerne i `systemPromptModel.md`, der skal løses ved køretid. Hver bladsvariabel løses til en streng, et tal eller en tom streng `""`; når en værdi ikke kan opnås, vender den ensartet tilbage til en tom streng.

## Arbejdsplads og brugermiljø

| Variable | Description | Example |
|---|---|---|
| `${environment.cwd}` | Aktuelt primært arbejdsmappe. | `/Users/sky/claude-code` |
| `${environment.originalCwd}` | Oprindeligt arbejdsmappe da processen/sessionen startede. | `/Users/sky/claude-code` |
| `${environment.home}` | Brugerens hjemmemappe, brugt til at løse `~`. | `/Users/sky` |
| `${environment.user}` | Aktuelt systembrutgernavn. | `sky` |
| `${environment.workspaceRoots}` | Arbejdspladser for den nuværende session; kan gengives som en linjeskilt streng. | `/Users/sky/claude-code` |
| `${environment.path}` | Aktuel proces PATH. | `/opt/homebrew/bin:/usr/bin:/bin` |
| `${environment.lang}` | Aktuelle regionindstillinger eller sprogmiljø. | `zh_CN.UTF-8` |

## Operativsystem

| Variable | Description | Example |
|---|---|---|
| `${os.platform}` | Platform som identificeret af Node.js. | `darwin` |
| `${os.type}` | Operativsystem type. | `Darwin` |
| `${os.arch}` | CPU-arkitektur. | `arm64` |
| `${os.shell}` | Aktuel skal. | `/bin/zsh` |
| `${os.version}` | Operativsystem version beskrivelse. | `Darwin Kernel Version ...` |
| `${os.release}` | Operativsystem udgivelse. | `24.5.0` |
| `${os.hostname}` | Aktuelt værtsnavn. | `MacBook-Pro.local` |
| `${os.availableParallelism}` | Tilgængelig parallelisme. | `10` |
| `${os.totalMemory}` | Samlet systemhukommelse i bytes. | `34359738368` |
| `${os.freeMemory}` | Fri hukommelse i bytes. | `8589934592` |
| `${os.uptime}` | System oppetid i sekunder. | `123456` |

## Node.js-køretid

| Variable | Description | Example |
|---|---|---|
| `${runtime.nodeVersion}` | Aktuel Node.js version. | `v24.14.0` |
| `${runtime.execPath}` | Sti til den aktuelle Node.js eksekverbar. | `/opt/homebrew/bin/node` |
| `${runtime.pid}` | Aktuel proces ID. | `12345` |
| `${runtime.ppid}` | Forældre proces ID. | `1234` |

## Tid

| Variable | Description | Example |
|---|---|---|
| `${time.current}` | Aktuel lokal tidsstreng. | `Thu Jul 09 2026 18:22:09 GMT+0800 (China Standard Time)` |
| `${time.iso}` | Aktuel ISO tid. | `2026-07-09T10:22:09.000Z` |
| `${time.date}` | Aktuel lokaldato. | `2026-07-09` |
| `${time.timezone}` | Aktuelt systemtidzone. | `Asia/Shanghai` |

## Tilladelser og sandkasse

| Variable | Description | Example |
|---|---|---|
| `${permissions.mode}` | Aktuelt værktøj tilladelses tilstand. | `default` |
| `${permissions.approvalsReviewer}` | Aktuel godkendelsespolitik eller anmeldertilstand. | `auto_review` |
| `${sandbox.mode}` | Filsystem sandkasse tilstand. | `workspace-write` |
| `${sandbox.networkAccess}` | Netværksadgangs status. | `enabled` |
| `${sandbox.writableRoots}` | Mapper som sandkassen tillader skrivning til; kan gengives som en linjeskilt streng. | `/Users/sky/Documents/Playground` |

## Terminal

| Variable | Description | Example |
|---|---|---|
| `${terminal.term}` | Aktuel TERM. | `xterm-256color` |
| `${terminal.colorTerm}` | Aktuel COLORTERM. | `truecolor` |
| `${terminal.columns}` | Aktuelt terminal kolonne antal. | `120` |
| `${terminal.rows}` | Aktuelt terminal rækkeantal. | `40` |

## Filsystem

| Variable | Description | Example |
|---|---|---|
| `${filesystem.tmpdir}` | System midlertidigt mappe. | `/var/folders/.../T` |
| `${filesystem.pathSeparator}` | Fil sti separator. | `/` |
| `${filesystem.pathDelimiter}` | PATH indgangs afgrænser. | `:` |

## Model

| Variable | Description | Example |
|---|---|---|
| `${model.name}` | Aktuelt model navn eller ID. | `claude-opus-4-6` |
| `${model.knowledgeCutoff}` | Aktuel model viden afskæring; denne værdi kan ikke udledes fra operativsystemet og skal injiceres via ekstern konfiguration eller en tilsidesættelse. | `May 2025` |

## Git

| Variable | Description | Example |
|---|---|---|
| `${git.isRepository}` | Hvorvidt det aktuelle mappe er inden i et git arkiv, som en streng. | `true` |
| `${git.root}` | Git arkiv rod mappe. | `/Users/sky/project` |
| `${git.branch}` | Aktuel git gren eller kort HEAD hash. | `main` |
| `${git.mainBranch}` | Standard hoved gren, typisk brugt som PR eller sammensmeltnings mål. | `main` |
| `${git.userName}` | Aktuel git `user.name`. | `Sky` |
| `${git.status}` | Output af `git status --short`. | `M src/index.ts` |
| `${git.recentCommits}` | Oversigt over seneste commits. | `abc1234 Fix prompt builder` |

## Hukommelse

Hukommelsesvariablerne beskriver den vedvarende filbaserede hukommelsesmappe. `${memory.dir}` løses fra `CC_MEMORY_DIR` / `CLAUDE_MEMORY_DIR` tilsidesættelse når den er indstillet; ellers beregnes det som `<home>/.claude/projects/<slug>/memory/`, hvor `<slug>` er det primære arbejdsmappe med hver ikke-alfanumerisk tegn erstattet med `-`. `${memory.index}` indeholder indholdet af `MEMORY.md` i det mappe (indekset indlæst hver session), og `${memory.enabled}` rapporterer hvorvidt hukommelse er tilgængelig. Afsnittene `# Memory` og `# Memory index` samles kun når hukommelsen er aktiveret.

| Variable | Description | Example |
|---|---|---|
| `${memory.dir}` | Løst hukommelsesmappe. | `/Users/sky/.claude/projects/-Users-sky-project/memory/` |
| `${memory.index}` | Indhold af `MEMORY.md`, eller `""` når fraværende. | `# Memory index\n- [Commit to main](commit-to-main.md) — hook` |
| `${memory.enabled}` | Hvorvidt hukommelse er tilgængelig, som en streng. | `true` |

## Notepad

Notepad mappe er session-specifik og kan ikke udledes fra operativsystemet; det skal injiceres via `CC_SCRATCHPAD_DIR` / `CLAUDE_SCRATCHPAD_DIR` tilsidesættelse. Når indstillet, falder det tilbage til `""`, og afsnittet `# Scratchpad Directory` udelades fra samlingen.

| Variable | Description | Example |
|---|---|---|
| `${scratchpad.dir}` | Session-specifik midlertidig mappe. | `/private/tmp/claude-501/<slug>/<session>/scratchpad` |
