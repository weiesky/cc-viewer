# variables de systemPromptModel.md

Este archivo documenta únicamente las variables en `systemPromptModel.md` que deben resolverse en tiempo de ejecución. Cada variable hoja se resuelve en una cadena, un número o una cadena vacía `""`; cuando no se puede obtener un valor, vuelve uniformemente a una cadena vacía.

## Espacio de trabajo y entorno del usuario

| Variable | Description | Example |
|---|---|---|
| `${environment.cwd}` | Directorio de trabajo principal actual. | `/Users/sky/claude-code` |
| `${environment.originalCwd}` | Directorio de trabajo original cuando se inició el proceso/sesión. | `/Users/sky/claude-code` |
| `${environment.home}` | Directorio de inicio del usuario, se utiliza para resolver `~`. | `/Users/sky` |
| `${environment.user}` | Nombre de usuario del sistema actual. | `sky` |
| `${environment.workspaceRoots}` | Raíces del espacio de trabajo para la sesión actual; puede representarse como una cadena separada por saltos de línea. | `/Users/sky/claude-code` |
| `${environment.path}` | PATH del proceso actual. | `/opt/homebrew/bin:/usr/bin:/bin` |
| `${environment.lang}` | Entorno de configuración regional o idioma actual. | `zh_CN.UTF-8` |

## Sistema operativo

| Variable | Description | Example |
|---|---|---|
| `${os.platform}` | Plataforma identificada por Node.js. | `darwin` |
| `${os.type}` | Tipo de sistema operativo. | `Darwin` |
| `${os.arch}` | Arquitectura de CPU. | `arm64` |
| `${os.shell}` | Shell actual. | `/bin/zsh` |
| `${os.version}` | Descripción de la versión del sistema operativo. | `Darwin Kernel Version ...` |
| `${os.release}` | Versión del sistema operativo. | `24.5.0` |
| `${os.hostname}` | Nombre de host actual. | `MacBook-Pro.local` |
| `${os.availableParallelism}` | Paralelismo disponible. | `10` |
| `${os.totalMemory}` | Memoria total del sistema, en bytes. | `34359738368` |
| `${os.freeMemory}` | Memoria libre, en bytes. | `8589934592` |
| `${os.uptime}` | Tiempo de actividad del sistema, en segundos. | `123456` |

## Tiempo de ejecución de Node.js

| Variable | Description | Example |
|---|---|---|
| `${runtime.nodeVersion}` | Versión actual de Node.js. | `v24.14.0` |
| `${runtime.execPath}` | Ruta al ejecutable de Node.js actual. | `/opt/homebrew/bin/node` |
| `${runtime.pid}` | ID de proceso actual. | `12345` |
| `${runtime.ppid}` | ID de proceso padre. | `1234` |

## Tiempo

| Variable | Description | Example |
|---|---|---|
| `${time.current}` | Cadena de hora local actual. | `Thu Jul 09 2026 18:22:09 GMT+0800 (China Standard Time)` |
| `${time.iso}` | Hora ISO actual. | `2026-07-09T10:22:09.000Z` |
| `${time.date}` | Fecha local actual. | `2026-07-09` |
| `${time.timezone}` | Zona horaria del sistema actual. | `Asia/Shanghai` |

## Permisos y sandbox

| Variable | Description | Example |
|---|---|---|
| `${permissions.mode}` | Modo de permiso de herramienta actual. | `default` |
| `${permissions.approvalsReviewer}` | Política de aprobación actual o modo de revisor. | `auto_review` |
| `${sandbox.mode}` | Modo de sandbox del sistema de archivos. | `workspace-write` |
| `${sandbox.networkAccess}` | Estado de acceso a la red. | `enabled` |
| `${sandbox.writableRoots}` | Directorios en los que el sandbox permite escribir; puede representarse como una cadena separada por saltos de línea. | `/Users/sky/Documents/Playground` |

## Terminal

| Variable | Description | Example |
|---|---|---|
| `${terminal.term}` | TERM actual. | `xterm-256color` |
| `${terminal.colorTerm}` | COLORTERM actual. | `truecolor` |
| `${terminal.columns}` | Recuento de columnas del terminal actual. | `120` |
| `${terminal.rows}` | Recuento de filas del terminal actual. | `40` |

## Sistema de archivos

| Variable | Description | Example |
|---|---|---|
| `${filesystem.tmpdir}` | Directorio temporal del sistema. | `/var/folders/.../T` |
| `${filesystem.pathSeparator}` | Separador de ruta de archivo. | `/` |
| `${filesystem.pathDelimiter}` | Delimitador de entrada PATH. | `:` |

## Modelo

| Variable | Description | Example |
|---|---|---|
| `${model.name}` | Nombre o ID del modelo actual. | `claude-opus-4-6` |
| `${model.knowledgeCutoff}` | Corte de conocimiento del modelo actual; este valor no se puede derivar del sistema operativo y debe inyectarse a través de configuración externa o una anulación. | `May 2025` |

## Git

| Variable | Description | Example |
|---|---|---|
| `${git.isRepository}` | Si el directorio actual está dentro de un repositorio de Git, como cadena. | `true` |
| `${git.root}` | Directorio raíz del repositorio de Git. | `/Users/sky/project` |
| `${git.branch}` | Rama de Git actual o hash HEAD corto. | `main` |
| `${git.mainBranch}` | Rama principal predeterminada, típicamente utilizada como destino de PR o fusión. | `main` |
| `${git.userName}` | `user.name` de Git actual. | `Sky` |
| `${git.status}` | Salida de `git status --short`. | `M src/index.ts` |
| `${git.recentCommits}` | Resumen de commits recientes. | `abc1234 Fix prompt builder` |

## Memoria

Las variables de memoria describen el directorio de memoria persistente basado en archivos. `${memory.dir}` se resuelve desde la anulación `CC_MEMORY_DIR` / `CLAUDE_MEMORY_DIR` cuando está configurada; de lo contrario, se calcula como `<home>/.claude/projects/<slug>/memory/`, donde `<slug>` es el directorio de trabajo principal con cada carácter no alfanumérico reemplazado por `-`. `${memory.index}` contiene el contenido de `MEMORY.md` dentro de ese directorio (el índice cargado cada sesión), y `${memory.enabled}` informa si la memoria está disponible. Las secciones `# Memory` e `# Memory index` solo se ensamblan cuando la memoria está habilitada.

| Variable | Description | Example |
|---|---|---|
| `${memory.dir}` | Directorio de memoria resuelto. | `/Users/sky/.claude/projects/-Users-sky-project/memory/` |
| `${memory.index}` | Contenido de `MEMORY.md`, o `""` cuando está ausente. | `# Memory index\n- [Commit to main](commit-to-main.md) — hook` |
| `${memory.enabled}` | Si la memoria está disponible, como cadena. | `true` |

## Scratchpad

El directorio scratchpad es específico de la sesión y no se puede derivar del sistema operativo; debe inyectarse a través de la anulación `CC_SCRATCHPAD_DIR` / `CLAUDE_SCRATCHPAD_DIR`. Cuando no está configurado, vuelve a `""`, y la sección `# Scratchpad Directory` se omite del ensamblaje.

| Variable | Description | Example |
|---|---|---|
| `${scratchpad.dir}` | Directorio temporal específico de la sesión. | `/private/tmp/claude-501/<slug>/<session>/scratchpad` |
