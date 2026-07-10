# Змінні systemPromptModel.md

Цей файл документує лише змінні в `systemPromptModel.md`, які мають бути розпізнані під час виконання. Кожна листкова змінна розпізнається в рядок, число або порожній рядок `""`; коли значення не вдається отримати, вона рівномірно переходить на порожній рядок.

## Робочий простір та оточення користувача

| Variable | Description | Example |
|---|---|---|
| `${environment.cwd}` | Поточний первинний робочий каталог. | `/Users/sky/claude-code` |
| `${environment.originalCwd}` | Вихідний робочий каталог при запуску процесу/сеансу. | `/Users/sky/claude-code` |
| `${environment.home}` | Домашній каталог користувача, використовується для розпізнання `~`. | `/Users/sky` |
| `${environment.user}` | Поточне ім'я користувача в системі. | `sky` |
| `${environment.workspaceRoots}` | Корені робочого простору для поточного сеансу; може відображатися як рядок, розділений новими рядками. | `/Users/sky/claude-code` |
| `${environment.path}` | Поточний PATH процесу. | `/opt/homebrew/bin:/usr/bin:/bin` |
| `${environment.lang}` | Поточна мова або оточення мови. | `zh_CN.UTF-8` |

## Операційна система

| Variable | Description | Example |
|---|---|---|
| `${os.platform}` | Платформа, як ідентифікує Node.js. | `darwin` |
| `${os.type}` | Тип операційної системи. | `Darwin` |
| `${os.arch}` | Архітектура процесора. | `arm64` |
| `${os.shell}` | Поточна оболонка. | `/bin/zsh` |
| `${os.version}` | Опис версії операційної системи. | `Darwin Kernel Version ...` |
| `${os.release}` | Випуск операційної системи. | `24.5.0` |
| `${os.hostname}` | Поточне ім'я хосту. | `MacBook-Pro.local` |
| `${os.availableParallelism}` | Доступний паралелізм. | `10` |
| `${os.totalMemory}` | Загальна пам'ять системи у байтах. | `34359738368` |
| `${os.freeMemory}` | Вільна пам'ять у байтах. | `8589934592` |
| `${os.uptime}` | Час роботи системи у секундах. | `123456` |

## Середовище виконання Node.js

| Variable | Description | Example |
|---|---|---|
| `${runtime.nodeVersion}` | Поточна версія Node.js. | `v24.14.0` |
| `${runtime.execPath}` | Шлях до поточного виконавчого файлу Node.js. | `/opt/homebrew/bin/node` |
| `${runtime.pid}` | Поточний ідентифікатор процесу. | `12345` |
| `${runtime.ppid}` | Ідентифікатор батьківського процесу. | `1234` |

## Час

| Variable | Description | Example |
|---|---|---|
| `${time.current}` | Рядок поточного місцевого часу. | `Thu Jul 09 2026 18:22:09 GMT+0800 (China Standard Time)` |
| `${time.iso}` | Поточний час у ISO. | `2026-07-09T10:22:09.000Z` |
| `${time.date}` | Поточна місцева дата. | `2026-07-09` |
| `${time.timezone}` | Поточний системний часовий пояс. | `Asia/Shanghai` |

## Дозволи та пісочниця

| Variable | Description | Example |
|---|---|---|
| `${permissions.mode}` | Поточний режим дозволу інструментів. | `default` |
| `${permissions.approvalsReviewer}` | Поточна політика затвердження або режим рецензента. | `auto_review` |
| `${sandbox.mode}` | Режим пісочниці файлової системи. | `workspace-write` |
| `${sandbox.networkAccess}` | Статус доступу до мережі. | `enabled` |
| `${sandbox.writableRoots}` | Каталоги, до яких пісочниця дозволяє запис; може відображатися як рядок, розділений новими рядками. | `/Users/sky/Documents/Playground` |

## Термінал

| Variable | Description | Example |
|---|---|---|
| `${terminal.term}` | Поточний TERM. | `xterm-256color` |
| `${terminal.colorTerm}` | Поточний COLORTERM. | `truecolor` |
| `${terminal.columns}` | Поточна кількість стовпців терміналу. | `120` |
| `${terminal.rows}` | Поточна кількість рядків терміналу. | `40` |

## Файлова система

| Variable | Description | Example |
|---|---|---|
| `${filesystem.tmpdir}` | Системний тимчасовий каталог. | `/var/folders/.../T` |
| `${filesystem.pathSeparator}` | Роздільник шляху файлу. | `/` |
| `${filesystem.pathDelimiter}` | Роздільник записів PATH. | `:` |

## Модель

| Variable | Description | Example |
|---|---|---|
| `${model.name}` | Поточне ім'я або ідентифікатор моделі. | `claude-opus-4-6` |
| `${model.knowledgeCutoff}` | Поточний зріз знань моделі; це значення не може бути отримано з операційної системи і має бути введено через зовнішню конфігурацію або перевизначення. | `May 2025` |

## Git

| Variable | Description | Example |
|---|---|---|
| `${git.isRepository}` | Чи знаходиться поточний каталог у репозиторії git як рядок. | `true` |
| `${git.root}` | Кореневий каталог репозиторія git. | `/Users/sky/project` |
| `${git.branch}` | Поточна гілка git або скорочений хеш HEAD. | `main` |
| `${git.mainBranch}` | Основна гілка за замовчуванням, зазвичай використовується як ціль PR або злиття. | `main` |
| `${git.userName}` | Поточне ім'я git `user.name`. | `Sky` |
| `${git.status}` | Результат `git status --short`. | `M src/index.ts` |
| `${git.recentCommits}` | Резюме недавніх комітів. | `abc1234 Fix prompt builder` |

## Пам'ять

Змінні пам'яті описують каталог постійної файлової пам'яті. `${memory.dir}` розпізнається з перевизначення `CC_MEMORY_DIR` / `CLAUDE_MEMORY_DIR` якщо встановлено; інакше обчислюється як `<home>/.claude/projects/<slug>/memory/`, де `<slug>` — це первинний робочий каталог з усіма не буквено-цифровими символами, заміненими на `-`. `${memory.index}` містить вміст `MEMORY.md` у цьому каталозі (індекс, завантажений кожного сеансу), і `${memory.enabled}` повідомляє, чи доступна пам'ять. Розділи `# Memory` і `# Memory index` збираються тільки коли пам'ять увімкнена.

| Variable | Description | Example |
|---|---|---|
| `${memory.dir}` | Розпізнаний каталог пам'яті. | `/Users/sky/.claude/projects/-Users-sky-project/memory/` |
| `${memory.index}` | Вміст `MEMORY.md` або `""` якщо відсутній. | `# Memory index\n- [Commit to main](commit-to-main.md) — hook` |
| `${memory.enabled}` | Чи доступна пам'ять як рядок. | `true` |

## Блокнот

Каталог блокнота залежить від сеансу і не може бути отриманий з операційної системи; він має бути введений через перевизначення `CC_SCRATCHPAD_DIR` / `CLAUDE_SCRATCHPAD_DIR`. Якщо не встановлено, він переходить на `""`, і розділ `# Scratchpad Directory` опускається зі збирання.

| Variable | Description | Example |
|---|---|---|
| `${scratchpad.dir}` | Тимчасовий каталог для поточного сеансу. | `/private/tmp/claude-501/<slug>/<session>/scratchpad` |
