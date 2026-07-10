# Переменные systemPromptModel.md

Этот файл документирует только переменные в `systemPromptModel.md`, которые должны быть разрешены во время выполнения. Каждая листовая переменная разрешается в строку, число или пустую строку `""`; когда значение не удается получить, она равномерно переходит на пустую строку.

## Рабочее пространство и окружение пользователя

| Variable | Description | Example |
|---|---|---|
| `${environment.cwd}` | Текущий первичный рабочий каталог. | `/Users/sky/claude-code` |
| `${environment.originalCwd}` | Исходный рабочий каталог при запуске процесса/сеанса. | `/Users/sky/claude-code` |
| `${environment.home}` | Домашний каталог пользователя, используется для разрешения `~`. | `/Users/sky` |
| `${environment.user}` | Текущее имя пользователя в системе. | `sky` |
| `${environment.workspaceRoots}` | Корни рабочего пространства для текущего сеанса; может отображаться как строка, разделённая новыми строками. | `/Users/sky/claude-code` |
| `${environment.path}` | Текущий PATH процесса. | `/opt/homebrew/bin:/usr/bin:/bin` |
| `${environment.lang}` | Текущая локаль или окружение языка. | `zh_CN.UTF-8` |

## Операционная система

| Variable | Description | Example |
|---|---|---|
| `${os.platform}` | Платформа, как идентифицирует Node.js. | `darwin` |
| `${os.type}` | Тип операционной системы. | `Darwin` |
| `${os.arch}` | Архитектура процессора. | `arm64` |
| `${os.shell}` | Текущая оболочка. | `/bin/zsh` |
| `${os.version}` | Описание версии операционной системы. | `Darwin Kernel Version ...` |
| `${os.release}` | Выпуск операционной системы. | `24.5.0` |
| `${os.hostname}` | Текущее имя хоста. | `MacBook-Pro.local` |
| `${os.availableParallelism}` | Доступный параллелизм. | `10` |
| `${os.totalMemory}` | Общая память системы в байтах. | `34359738368` |
| `${os.freeMemory}` | Свободная память в байтах. | `8589934592` |
| `${os.uptime}` | Время работы системы в секундах. | `123456` |

## Среда выполнения Node.js

| Variable | Description | Example |
|---|---|---|
| `${runtime.nodeVersion}` | Текущая версия Node.js. | `v24.14.0` |
| `${runtime.execPath}` | Путь к текущему исполняемому файлу Node.js. | `/opt/homebrew/bin/node` |
| `${runtime.pid}` | Текущий идентификатор процесса. | `12345` |
| `${runtime.ppid}` | Идентификатор родительского процесса. | `1234` |

## Время

| Variable | Description | Example |
|---|---|---|
| `${time.current}` | Строка текущего местного времени. | `Thu Jul 09 2026 18:22:09 GMT+0800 (China Standard Time)` |
| `${time.iso}` | Текущее время в ISO. | `2026-07-09T10:22:09.000Z` |
| `${time.date}` | Текущая местная дата. | `2026-07-09` |
| `${time.timezone}` | Текущий системный часовой пояс. | `Asia/Shanghai` |

## Разрешения и песочница

| Variable | Description | Example |
|---|---|---|
| `${permissions.mode}` | Текущий режим разрешения инструментов. | `default` |
| `${permissions.approvalsReviewer}` | Текущая политика утверждения или режим рецензента. | `auto_review` |
| `${sandbox.mode}` | Режим песочницы файловой системы. | `workspace-write` |
| `${sandbox.networkAccess}` | Статус сетевого доступа. | `enabled` |
| `${sandbox.writableRoots}` | Каталоги, в которые песочница разрешает запись; может отображаться как строка, разделённая новыми строками. | `/Users/sky/Documents/Playground` |

## Терминал

| Variable | Description | Example |
|---|---|---|
| `${terminal.term}` | Текущий TERM. | `xterm-256color` |
| `${terminal.colorTerm}` | Текущий COLORTERM. | `truecolor` |
| `${terminal.columns}` | Текущее количество столбцов терминала. | `120` |
| `${terminal.rows}` | Текущее количество строк терминала. | `40` |

## Файловая система

| Variable | Description | Example |
|---|---|---|
| `${filesystem.tmpdir}` | Системный временный каталог. | `/var/folders/.../T` |
| `${filesystem.pathSeparator}` | Разделитель пути файла. | `/` |
| `${filesystem.pathDelimiter}` | Разделитель записей PATH. | `:` |

## Модель

| Variable | Description | Example |
|---|---|---|
| `${model.name}` | Текущее имя или идентификатор модели. | `claude-opus-4-6` |
| `${model.knowledgeCutoff}` | Текущий срез знаний модели; это значение не может быть получено из операционной системы и должно быть введено через внешнюю конфигурацию или переопределение. | `May 2025` |

## Git

| Variable | Description | Example |
|---|---|---|
| `${git.isRepository}` | Находится ли текущий каталог в репозитории git в виде строки. | `true` |
| `${git.root}` | Корневой каталог репозитория git. | `/Users/sky/project` |
| `${git.branch}` | Текущая ветка git или сокращённый хеш HEAD. | `main` |
| `${git.mainBranch}` | Основная ветка по умолчанию, обычно используется как цель PR или слияния. | `main` |
| `${git.userName}` | Текущее имя git `user.name`. | `Sky` |
| `${git.status}` | Вывод `git status --short`. | `M src/index.ts` |
| `${git.recentCommits}` | Сводка недавних коммитов. | `abc1234 Fix prompt builder` |

## Память

Переменные памяти описывают каталог постоянной файловой памяти. `${memory.dir}` разрешается из переопределения `CC_MEMORY_DIR` / `CLAUDE_MEMORY_DIR` если установлено; иначе вычисляется как `<home>/.claude/projects/<slug>/memory/`, где `<slug>` — это первичный рабочий каталог со всеми не алфавитно-цифровыми символами, замененными на `-`. `${memory.index}` содержит содержимое `MEMORY.md` в этом каталоге (индекс, загруженный каждый сеанс), и `${memory.enabled}` сообщает, доступна ли память. Разделы `# Memory` и `# Memory index` собираются только когда память включена.

| Variable | Description | Example |
|---|---|---|
| `${memory.dir}` | Разрешённый каталог памяти. | `/Users/sky/.claude/projects/-Users-sky-project/memory/` |
| `${memory.index}` | Содержимое `MEMORY.md` или `""` если отсутствует. | `# Memory index\n- [Commit to main](commit-to-main.md) — hook` |
| `${memory.enabled}` | Доступна ли память в виде строки. | `true` |

## Блокнот

Каталог блокнота зависит от сеанса и не может быть получен из операционной системы; он должен быть введён через переопределение `CC_SCRATCHPAD_DIR` / `CLAUDE_SCRATCHPAD_DIR`. Если не установлено, оно переходит на `""`, и раздел `# Scratchpad Directory` опускается из сборки.

| Variable | Description | Example |
|---|---|---|
| `${scratchpad.dir}` | Временный каталог для текущего сеанса. | `/private/tmp/claude-501/<slug>/<session>/scratchpad` |
