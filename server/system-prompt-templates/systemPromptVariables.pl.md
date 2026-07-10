# systemPromptModel.md zmienne

Ten plik dokumentuje tylko zmienne w `systemPromptModel.md`, które muszą być rozwiązane w czasie wykonywania. Każda zmienna węzła liścia jest rozwiązywana do ciągu znaków, liczby lub pustego ciągu `""`; gdy wartość nie może być uzyskana, jednolicie powraca do pustego ciągu.

## Przestrzeń robocza i środowisko użytkownika

| Variable | Description | Example |
|---|---|---|
| `${environment.cwd}` | Bieżący główny katalog roboczy. | `/Users/sky/claude-code` |
| `${environment.originalCwd}` | Oryginalny katalog roboczy w momencie rozpoczęcia procesu/sesji. | `/Users/sky/claude-code` |
| `${environment.home}` | Katalog domowy użytkownika, używany do rozwiązywania `~`. | `/Users/sky` |
| `${environment.user}` | Bieżąca nazwa użytkownika systemu. | `sky` |
| `${environment.workspaceRoots}` | Katalogi główne przestrzeni roboczej dla bieżącej sesji; mogą być renderowane jako ciąg oddzielony znakami nowego wiersza. | `/Users/sky/claude-code` |
| `${environment.path}` | Bieżąca ścieżka PATH procesu. | `/opt/homebrew/bin:/usr/bin:/bin` |
| `${environment.lang}` | Bieżące ustawienia regionalne lub środowisko języka. | `zh_CN.UTF-8` |

## System operacyjny

| Variable | Description | Example |
|---|---|---|
| `${os.platform}` | Platforma identyfikowana przez Node.js. | `darwin` |
| `${os.type}` | Typ systemu operacyjnego. | `Darwin` |
| `${os.arch}` | Architektura procesora. | `arm64` |
| `${os.shell}` | Bieżąca powłoka. | `/bin/zsh` |
| `${os.version}` | Opis wersji systemu operacyjnego. | `Darwin Kernel Version ...` |
| `${os.release}` | Wydanie systemu operacyjnego. | `24.5.0` |
| `${os.hostname}` | Bieżąca nazwa hosta. | `MacBook-Pro.local` |
| `${os.availableParallelism}` | Dostępny paralelizm. | `10` |
| `${os.totalMemory}` | Całkowita pamięć systemu w bajtach. | `34359738368` |
| `${os.freeMemory}` | Wolna pamięć w bajtach. | `8589934592` |
| `${os.uptime}` | Czas pracy systemu w sekundach. | `123456` |

## Środowisko wykonawcze Node.js

| Variable | Description | Example |
|---|---|---|
| `${runtime.nodeVersion}` | Bieżąca wersja Node.js. | `v24.14.0` |
| `${runtime.execPath}` | Ścieżka do bieżącego pliku wykonywalnego Node.js. | `/opt/homebrew/bin/node` |
| `${runtime.pid}` | Bieżący identyfikator procesu. | `12345` |
| `${runtime.ppid}` | Identyfikator procesu rodzicielskiego. | `1234` |

## Czas

| Variable | Description | Example |
|---|---|---|
| `${time.current}` | Bieżący lokalny ciąg znaków czasu. | `Thu Jul 09 2026 18:22:09 GMT+0800 (China Standard Time)` |
| `${time.iso}` | Bieżący czas ISO. | `2026-07-09T10:22:09.000Z` |
| `${time.date}` | Bieżąca data lokalna. | `2026-07-09` |
| `${time.timezone}` | Bieżąca strefa czasowa systemu. | `Asia/Shanghai` |

## Uprawnienia i piaskownica

| Variable | Description | Example |
|---|---|---|
| `${permissions.mode}` | Bieżący tryb uprawnień narzędziowych. | `default` |
| `${permissions.approvalsReviewer}` | Bieżąca polityka zatwierdzenia lub tryb recenzenta. | `auto_review` |
| `${sandbox.mode}` | Tryb piaskownic systemu plików. | `workspace-write` |
| `${sandbox.networkAccess}` | Stan dostępu do sieci. | `enabled` |
| `${sandbox.writableRoots}` | Katalogi, do których piaskownica zezwala na pisanie; mogą być renderowane jako ciąg oddzielony znakami nowego wiersza. | `/Users/sky/Documents/Playground` |

## Terminal

| Variable | Description | Example |
|---|---|---|
| `${terminal.term}` | Bieżący TERM. | `xterm-256color` |
| `${terminal.colorTerm}` | Bieżący COLORTERM. | `truecolor` |
| `${terminal.columns}` | Bieżąca liczba kolumn terminala. | `120` |
| `${terminal.rows}` | Bieżąca liczba wierszy terminala. | `40` |

## System plików

| Variable | Description | Example |
|---|---|---|
| `${filesystem.tmpdir}` | Katalog tymczasowy systemu. | `/var/folders/.../T` |
| `${filesystem.pathSeparator}` | Separator ścieżki pliku. | `/` |
| `${filesystem.pathDelimiter}` | Ogranicznik wpisu PATH. | `:` |

## Model

| Variable | Description | Example |
|---|---|---|
| `${model.name}` | Bieżąca nazwa modelu lub identyfikator. | `claude-opus-4-6` |
| `${model.knowledgeCutoff}` | Bieżący limit wiedzy modelu; ta wartość nie może być pochodną z systemu operacyjnego i musi być wstrzyknięta poprzez konfigurację zewnętrzną lub przesłonięcie. | `May 2025` |

## Git

| Variable | Description | Example |
|---|---|---|
| `${git.isRepository}` | Czy bieżący katalog znajduje się w repozytorium git, jako ciąg. | `true` |
| `${git.root}` | Katalog główny repozytorium git. | `/Users/sky/project` |
| `${git.branch}` | Bieżąca gałąź git lub krótka skrót HEAD. | `main` |
| `${git.mainBranch}` | Domyślna gałąź główna, zazwyczaj używana jako cel PR lub połączenia. | `main` |
| `${git.userName}` | Bieżące git `user.name`. | `Sky` |
| `${git.status}` | Wyjście `git status --short`. | `M src/index.ts` |
| `${git.recentCommits}` | Streszczenie niedawnych zatwierdzeń. | `abc1234 Fix prompt builder` |

## Pamięć

Zmienne pamięci opisują trwały katalog pamięci oparty na plikach. `${memory.dir}` jest rozwiązywany z przesłonięcia `CC_MEMORY_DIR` / `CLAUDE_MEMORY_DIR`, gdy jest ustawiony; w przeciwnym razie jest obliczany jako `<home>/.claude/projects/<slug>/memory/`, gdzie `<slug>` jest głównym katalogiem roboczym, w którym każdy znak niealfanumeryczny jest zastępowany przez `-`. `${memory.index}` zawiera zawartość `MEMORY.md` w tym katalogu (indeks ładowany w każdej sesji), a `${memory.enabled}` raportuje, czy pamięć jest dostępna. Sekcje `# Memory` i `# Memory index` są montowane tylko wtedy, gdy pamięć jest włączona.

| Variable | Description | Example |
|---|---|---|
| `${memory.dir}` | Rozwiązany katalog pamięci. | `/Users/sky/.claude/projects/-Users-sky-project/memory/` |
| `${memory.index}` | Zawartość `MEMORY.md` lub `""` gdy jest nieobecny. | `# Memory index\n- [Commit to main](commit-to-main.md) — hook` |
| `${memory.enabled}` | Czy pamięć jest dostępna, jako ciąg. | `true` |

## Notatnik

Katalog notatnika jest specyficzny dla sesji i nie może być pobierany z systemu operacyjnego; musi być wstrzykiwany poprzez przesłonięcie `CC_SCRATCHPAD_DIR` / `CLAUDE_SCRATCHPAD_DIR`. Gdy nie jest ustawiony, powraca do `""`, a sekcja `# Scratchpad Directory` jest pomijana w montażu.

| Variable | Description | Example |
|---|---|---|
| `${scratchpad.dir}` | Katalog tymczasowy specyficzny dla sesji. | `/private/tmp/claude-501/<slug>/<session>/scratchpad` |
