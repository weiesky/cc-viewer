# systemPromptModel.md-Variablen

Diese Datei dokumentiert nur die Variablen in `systemPromptModel.md`, die zur Laufzeit aufgelöst werden müssen. Jede Blattvariable wird zu einem String, einer Zahl oder einem leeren String `""`; wenn ein Wert nicht erhalten werden kann, wird uniform auf einen leeren String zurückgegriffen.

## Arbeitsbereich und Benutzerumgebung

| Variable | Description | Example |
|---|---|---|
| `${environment.cwd}` | Aktuelles primäres Arbeitsverzeichnis. | `/Users/sky/claude-code` |
| `${environment.originalCwd}` | Ursprüngliches Arbeitsverzeichnis beim Prozess-/Sessionstart. | `/Users/sky/claude-code` |
| `${environment.home}` | Benutzer-Stammverzeichnis, wird zur Auflösung von `~` verwendet. | `/Users/sky` |
| `${environment.user}` | Aktueller Systembenutzername. | `sky` |
| `${environment.workspaceRoots}` | Arbeitsbereichs-Stammverzeichnisse für die aktuelle Session; kann als Zeilenumbruch-getrennter String dargestellt werden. | `/Users/sky/claude-code` |
| `${environment.path}` | Aktuelles Prozess-PATH. | `/opt/homebrew/bin:/usr/bin:/bin` |
| `${environment.lang}` | Aktuelle Gebietsschema- oder Sprachumgebung. | `zh_CN.UTF-8` |

## Betriebssystem

| Variable | Description | Example |
|---|---|---|
| `${os.platform}` | Plattform wie von Node.js identifiziert. | `darwin` |
| `${os.type}` | Betriebssystemtyp. | `Darwin` |
| `${os.arch}` | CPU-Architektur. | `arm64` |
| `${os.shell}` | Aktuelle Shell. | `/bin/zsh` |
| `${os.version}` | Betriebssystem-Versionsbeschreibung. | `Darwin Kernel Version ...` |
| `${os.release}` | Betriebssystem-Release. | `24.5.0` |
| `${os.hostname}` | Aktueller Hostname. | `MacBook-Pro.local` |
| `${os.availableParallelism}` | Verfügbarer Parallelismus. | `10` |
| `${os.totalMemory}` | Gesamtspeicher des Systems in Bytes. | `34359738368` |
| `${os.freeMemory}` | Freier Speicher in Bytes. | `8589934592` |
| `${os.uptime}` | Systemlaufzeit in Sekunden. | `123456` |

## Node.js-Laufzeit

| Variable | Description | Example |
|---|---|---|
| `${runtime.nodeVersion}` | Aktuelle Node.js-Version. | `v24.14.0` |
| `${runtime.execPath}` | Pfad zur aktuellen Node.js-Executable. | `/opt/homebrew/bin/node` |
| `${runtime.pid}` | Aktuelle Prozess-ID. | `12345` |
| `${runtime.ppid}` | Übergeordnete Prozess-ID. | `1234` |

## Zeit

| Variable | Description | Example |
|---|---|---|
| `${time.current}` | Aktuelle lokale Zeitzeichenkette. | `Thu Jul 09 2026 18:22:09 GMT+0800 (China Standard Time)` |
| `${time.iso}` | Aktuelle ISO-Zeit. | `2026-07-09T10:22:09.000Z` |
| `${time.date}` | Aktuelles lokales Datum. | `2026-07-09` |
| `${time.timezone}` | Aktuelle Systemzeitzone. | `Asia/Shanghai` |

## Berechtigungen und Sandbox

| Variable | Description | Example |
|---|---|---|
| `${permissions.mode}` | Aktueller Tool-Berechtigungsmodus. | `default` |
| `${permissions.approvalsReviewer}` | Aktuelle Genehmigungsrichtlinie oder Reviewer-Modus. | `auto_review` |
| `${sandbox.mode}` | Dateisystem-Sandboxmodus. | `workspace-write` |
| `${sandbox.networkAccess}` | Netzwerkzugriffsstatus. | `enabled` |
| `${sandbox.writableRoots}` | Verzeichnisse, in die die Sandbox schreiben darf; kann als Zeilenumbruch-getrennter String dargestellt werden. | `/Users/sky/Documents/Playground` |

## Terminal

| Variable | Description | Example |
|---|---|---|
| `${terminal.term}` | Aktuelles TERM. | `xterm-256color` |
| `${terminal.colorTerm}` | Aktuelles COLORTERM. | `truecolor` |
| `${terminal.columns}` | Aktuelle Terminal-Spaltenzahl. | `120` |
| `${terminal.rows}` | Aktuelle Terminal-Zeilenzahl. | `40` |

## Dateisystem

| Variable | Description | Example |
|---|---|---|
| `${filesystem.tmpdir}` | Systemverzeichnis für temporäre Dateien. | `/var/folders/.../T` |
| `${filesystem.pathSeparator}` | Dateipfad-Trennzeichen. | `/` |
| `${filesystem.pathDelimiter}` | PATH-Eintragsabgrenzung. | `:` |

## Modell

| Variable | Description | Example |
|---|---|---|
| `${model.name}` | Aktueller Modellname oder ID. | `claude-opus-4-6` |
| `${model.knowledgeCutoff}` | Aktueller Wissensstand des Modells; dieser Wert kann nicht vom Betriebssystem abgeleitet werden und muss über externe Konfiguration oder einen Override injiziert werden. | `May 2025` |

## Git

| Variable | Description | Example |
|---|---|---|
| `${git.isRepository}` | Ob sich das aktuelle Verzeichnis in einem Git-Repository befindet, als String. | `true` |
| `${git.root}` | Stammverzeichnis des Git-Repositories. | `/Users/sky/project` |
| `${git.branch}` | Aktueller Git-Branch oder kurzer HEAD-Hash. | `main` |
| `${git.mainBranch}` | Standard-Hauptbranch, typischerweise als PR- oder Merge-Ziel verwendet. | `main` |
| `${git.userName}` | Aktueller Git `user.name`. | `Sky` |
| `${git.status}` | Ausgabe von `git status --short`. | `M src/index.ts` |
| `${git.recentCommits}` | Zusammenfassung der letzten Commits. | `abc1234 Fix prompt builder` |

## Speicher

Die Speichervariablen beschreiben das persistente dateibasierte Speicherverzeichnis. `${memory.dir}` wird aus dem Override `CC_MEMORY_DIR` / `CLAUDE_MEMORY_DIR` aufgelöst, wenn gesetzt; ansonsten wird es als `<home>/.claude/projects/<slug>/memory/` berechnet, wobei `<slug>` das primäre Arbeitsverzeichnis mit jedem nicht-alphanumerischen Zeichen ist, das durch `-` ersetzt wird. `${memory.index}` enthält den Inhalt von `MEMORY.md` in diesem Verzeichnis (der Index, der jede Session geladen wird), und `${memory.enabled}` meldet, ob Speicher verfügbar ist. Die Abschnitte `# Memory` und `# Memory index` werden nur zusammengestellt, wenn Speicher aktiviert ist.

| Variable | Description | Example |
|---|---|---|
| `${memory.dir}` | Aufgelöstes Speicherverzeichnis. | `/Users/sky/.claude/projects/-Users-sky-project/memory/` |
| `${memory.index}` | Inhalt von `MEMORY.md` oder `""` wenn nicht vorhanden. | `# Memory index\n- [Commit to main](commit-to-main.md) — hook` |
| `${memory.enabled}` | Ob Speicher verfügbar ist, als String. | `true` |

## Scratchpad

Das Scratchpad-Verzeichnis ist sessionspezifisch und kann nicht vom Betriebssystem abgeleitet werden; es muss über den Override `CC_SCRATCHPAD_DIR` / `CLAUDE_SCRATCHPAD_DIR` injiziert werden. Wenn nicht gesetzt, wird auf `""` zurückgegriffen, und der Abschnitt `# Scratchpad Directory` wird aus der Montage weggelassen.

| Variable | Description | Example |
|---|---|---|
| `${scratchpad.dir}` | Sessionspezifisches temporäres Verzeichnis. | `/private/tmp/claude-501/<slug>/<session>/scratchpad` |
