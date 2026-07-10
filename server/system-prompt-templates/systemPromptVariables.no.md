# systemPromptModel.md variabler

Denne filen dokumenterer bare variablene i `systemPromptModel.md` som må løses under kjøring. Hver bladnode-variabel løses til en streng, et tall eller en tom streng `""`; når en verdi ikke kan oppnås, faller den enhetlig tilbake til en tom streng.

## Arbeidsområde og brukermiljø

| Variable | Description | Example |
|---|---|---|
| `${environment.cwd}` | Gjeldende primær arbeidskatalog. | `/Users/sky/claude-code` |
| `${environment.originalCwd}` | Opprinnelig arbeidskatalog når prosessen/økten startet. | `/Users/sky/claude-code` |
| `${environment.home}` | Brukerens hjemmekatalog, brukt til å løse `~`. | `/Users/sky` |
| `${environment.user}` | Gjeldende systembryger navn. | `sky` |
| `${environment.workspaceRoots}` | Arbeidsromroter for den gjeldende økten; kan gjengi seg som en linjeskilt streng. | `/Users/sky/claude-code` |
| `${environment.path}` | Gjeldende prosess PATH. | `/opt/homebrew/bin:/usr/bin:/bin` |
| `${environment.lang}` | Gjeldende regional innstilling eller språkmiljø. | `zh_CN.UTF-8` |

## Operativsystem

| Variable | Description | Example |
|---|---|---|
| `${os.platform}` | Plattform som identifisert av Node.js. | `darwin` |
| `${os.type}` | Operativsystem type. | `Darwin` |
| `${os.arch}` | CPU-arkitektur. | `arm64` |
| `${os.shell}` | Gjeldende skal. | `/bin/zsh` |
| `${os.version}` | Operativsystem versjon beskrivelse. | `Darwin Kernel Version ...` |
| `${os.release}` | Operativsystem frigjøring. | `24.5.0` |
| `${os.hostname}` | Gjeldende vertsnavn. | `MacBook-Pro.local` |
| `${os.availableParallelism}` | Tilgjengelig parallellisme. | `10` |
| `${os.totalMemory}` | Total systemhukommelse i bytes. | `34359738368` |
| `${os.freeMemory}` | Ledig hukommelse i bytes. | `8589934592` |
| `${os.uptime}` | System oppetid i sekunder. | `123456` |

## Node.js-kjøretid

| Variable | Description | Example |
|---|---|---|
| `${runtime.nodeVersion}` | Gjeldende Node.js versjon. | `v24.14.0` |
| `${runtime.execPath}` | Sti til den gjeldende Node.js kjørbar. | `/opt/homebrew/bin/node` |
| `${runtime.pid}` | Gjeldende prosess ID. | `12345` |
| `${runtime.ppid}` | Overordnet prosess ID. | `1234` |

## Tid

| Variable | Description | Example |
|---|---|---|
| `${time.current}` | Gjeldende lokal tidsstreng. | `Thu Jul 09 2026 18:22:09 GMT+0800 (China Standard Time)` |
| `${time.iso}` | Gjeldende ISO tid. | `2026-07-09T10:22:09.000Z` |
| `${time.date}` | Gjeldende lokaldato. | `2026-07-09` |
| `${time.timezone}` | Gjeldende systemtidssone. | `Asia/Shanghai` |

## Tillatelser og sandkasse

| Variable | Description | Example |
|---|---|---|
| `${permissions.mode}` | Gjeldende verktøytillatelse tilstand. | `default` |
| `${permissions.approvalsReviewer}` | Gjeldende godkjennings policy eller anmeldertilstand. | `auto_review` |
| `${sandbox.mode}` | Filsystem sandkasse tilstand. | `workspace-write` |
| `${sandbox.networkAccess}` | Nettverksadgang status. | `enabled` |
| `${sandbox.writableRoots}` | Kataloger som sandkassen tillater skriving til; kan gjengi seg som en linjeskilt streng. | `/Users/sky/Documents/Playground` |

## Terminal

| Variable | Description | Example |
|---|---|---|
| `${terminal.term}` | Gjeldende TERM. | `xterm-256color` |
| `${terminal.colorTerm}` | Gjeldende COLORTERM. | `truecolor` |
| `${terminal.columns}` | Gjeldende terminal kolonne tall. | `120` |
| `${terminal.rows}` | Gjeldende terminal rad tall. | `40` |

## Filsystem

| Variable | Description | Example |
|---|---|---|
| `${filesystem.tmpdir}` | System midlertidig katalog. | `/var/folders/.../T` |
| `${filesystem.pathSeparator}` | Fil sti separator. | `/` |
| `${filesystem.pathDelimiter}` | PATH oppføring skilletegn. | `:` |

## Modell

| Variable | Description | Example |
|---|---|---|
| `${model.name}` | Gjeldende modell navn eller ID. | `claude-opus-4-6` |
| `${model.knowledgeCutoff}` | Gjeldende modell kunnskaps avskjæring; denne verdien kan ikke utledes fra operativsystemet og må injiseres via ekstern konfigurering eller en overstyring. | `May 2025` |

## Git

| Variable | Description | Example |
|---|---|---|
| `${git.isRepository}` | Hvorvidt gjeldende katalog er innenfor et git arkiv, som en streng. | `true` |
| `${git.root}` | Git arkiv rot katalog. | `/Users/sky/project` |
| `${git.branch}` | Gjeldende git gren eller kort HEAD hash. | `main` |
| `${git.mainBranch}` | Standard hoved gren, typisk brukt som PR eller sammensmeltings mål. | `main` |
| `${git.userName}` | Gjeldende git `user.name`. | `Sky` |
| `${git.status}` | Utdata fra `git status --short`. | `M src/index.ts` |
| `${git.recentCommits}` | Oppsummering av nylige commits. | `abc1234 Fix prompt builder` |

## Minne

Minnevariablene beskriver den vedvarende filbaserte minnemappen. `${memory.dir}` løses fra `CC_MEMORY_DIR` / `CLAUDE_MEMORY_DIR` overstyring når den er satt; ellers beregnes det som `<home>/.claude/projects/<slug>/memory/`, der `<slug>` er den primære arbeidskatalogen med hvert ikke-alfanumerisk tegn erstattet med `-`. `${memory.index}` inneholder innholdet av `MEMORY.md` inne i den katalogen (indeksen som lastes hver økt), og `${memory.enabled}` rapporterer om minne er tilgjengelig. Avsnittene `# Memory` og `# Memory index` settes bare sammen når minne er aktivert.

| Variable | Description | Example |
|---|---|---|
| `${memory.dir}` | Løst minne katalog. | `/Users/sky/.claude/projects/-Users-sky-project/memory/` |
| `${memory.index}` | Innhold av `MEMORY.md`, eller `""` når fraværende. | `# Memory index\n- [Commit to main](commit-to-main.md) — hook` |
| `${memory.enabled}` | Hvorvidt minne er tilgjengelig, som en streng. | `true` |

## Kladd-område

Kladd-områdets katalog er øktspesifikk og kan ikke hentes fra operativsystemet; den må injiseres via `CC_SCRATCHPAD_DIR` / `CLAUDE_SCRATCHPAD_DIR` overstyring. Når den ikke er satt, faller den tilbake til `""`, og delen `# Scratchpad Directory` utelates fra samlingen.

| Variable | Description | Example |
|---|---|---|
| `${scratchpad.dir}` | Økt-spesifikk midlertidig katalog. | `/private/tmp/claude-501/<slug>/<session>/scratchpad` |
