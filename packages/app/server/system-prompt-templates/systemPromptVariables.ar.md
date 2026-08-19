# متغيرات systemPromptModel.md

يوثق هذا الملف فقط المتغيرات في `systemPromptModel.md` التي يجب حلها في وقت التشغيل. يتم حل كل متغير ورقي إلى سلسلة أو رقم أو سلسلة فارغة `""`؛ عند عدم إمكانية الحصول على قيمة، يتم الرجوع إليها بشكل موحد إلى سلسلة فارغة.

## بيئة مساحة العمل والمستخدم

| Variable | Description | Example |
|---|---|---|
| `${environment.cwd}` | دليل العمل الأساسي الحالي. | `/Users/sky/claude-code` |
| `${environment.originalCwd}` | دليل العمل الأصلي عند بدء العملية/الجلسة. | `/Users/sky/claude-code` |
| `${environment.home}` | دليل منزل المستخدم، يُستخدم لحل `~`. | `/Users/sky` |
| `${environment.user}` | اسم المستخدم الحالي في النظام. | `sky` |
| `${environment.workspaceRoots}` | جذور مساحة العمل للجلسة الحالية؛ قد تُعرض كسلسلة مفصولة بأسطر جديدة. | `/Users/sky/claude-code` |
| `${environment.path}` | المسار الحالي للعملية. | `/opt/homebrew/bin:/usr/bin:/bin` |
| `${environment.lang}` | الإعدادات المحلية الحالية أو بيئة اللغة. | `zh_CN.UTF-8` |

## نظام التشغيل

| Variable | Description | Example |
|---|---|---|
| `${os.platform}` | المنصة كما يحددها Node.js. | `darwin` |
| `${os.type}` | نوع نظام التشغيل. | `Darwin` |
| `${os.arch}` | بنية المعالج. | `arm64` |
| `${os.shell}` | الصدفة الحالية. | `/bin/zsh` |
| `${os.version}` | وصف إصدار نظام التشغيل. | `Darwin Kernel Version ...` |
| `${os.release}` | إصدار نظام التشغيل. | `24.5.0` |
| `${os.hostname}` | اسم المضيف الحالي. | `MacBook-Pro.local` |
| `${os.availableParallelism}` | التوازي المتاح. | `10` |
| `${os.totalMemory}` | إجمالي ذاكرة النظام بالبايتات. | `34359738368` |
| `${os.freeMemory}` | الذاكرة المجانية بالبايتات. | `8589934592` |
| `${os.uptime}` | وقت تشغيل النظام بالثواني. | `123456` |

## بيئة تشغيل Node.js

| Variable | Description | Example |
|---|---|---|
| `${runtime.nodeVersion}` | إصدار Node.js الحالي. | `v24.14.0` |
| `${runtime.execPath}` | المسار إلى ملف تنفيذ Node.js الحالي. | `/opt/homebrew/bin/node` |
| `${runtime.pid}` | معرّف العملية الحالي. | `12345` |
| `${runtime.ppid}` | معرّف العملية الأبوية. | `1234` |

## الوقت

| Variable | Description | Example |
|---|---|---|
| `${time.current}` | سلسلة الوقت المحلي الحالي. | `Thu Jul 09 2026 18:22:09 GMT+0800 (China Standard Time)` |
| `${time.iso}` | الوقت الحالي بصيغة ISO. | `2026-07-09T10:22:09.000Z` |
| `${time.date}` | التاريخ المحلي الحالي. | `2026-07-09` |
| `${time.timezone}` | المنطقة الزمنية للنظام الحالية. | `Asia/Shanghai` |

## الأذونات والحماية

| Variable | Description | Example |
|---|---|---|
| `${permissions.mode}` | وضع إذن الأداة الحالي. | `default` |
| `${permissions.approvalsReviewer}` | سياسة الموافقة الحالية أو وضع المراجع. | `auto_review` |
| `${sandbox.mode}` | وضع الحماية لنظام الملفات. | `workspace-write` |
| `${sandbox.networkAccess}` | حالة الوصول إلى الشبكة. | `enabled` |
| `${sandbox.writableRoots}` | الأدلة التي تسمح الحماية بالكتابة إليها؛ قد تُعرض كسلسلة مفصولة بأسطر جديدة. | `/Users/sky/Documents/Playground` |

## المحطة الطرفية

| Variable | Description | Example |
|---|---|---|
| `${terminal.term}` | TERM الحالي. | `xterm-256color` |
| `${terminal.colorTerm}` | COLORTERM الحالي. | `truecolor` |
| `${terminal.columns}` | عدد أعمدة المحطة الطرفية الحالي. | `120` |
| `${terminal.rows}` | عدد صفوف المحطة الطرفية الحالي. | `40` |

## نظام الملفات

| Variable | Description | Example |
|---|---|---|
| `${filesystem.tmpdir}` | دليل النظام المؤقت. | `/var/folders/.../T` |
| `${filesystem.pathSeparator}` | فاصل مسار الملف. | `/` |
| `${filesystem.pathDelimiter}` | فاصل إدخالات PATH. | `:` |

## النموذج

| Variable | Description | Example |
|---|---|---|
| `${model.name}` | اسم النموذج أو معرّفه الحالي. | `claude-opus-4-6` |
| `${model.knowledgeCutoff}` | الحد الزمني الحالي لمعرفة النموذج؛ لا يمكن استخراج هذه القيمة من نظام التشغيل ويجب إدراجها عبر إعدادات خارجية أو استبدال. | `May 2025` |

## Git

| Variable | Description | Example |
|---|---|---|
| `${git.isRepository}` | ما إذا كان الدليل الحالي داخل مستودع git كسلسلة. | `true` |
| `${git.root}` | دليل جذر مستودع git. | `/Users/sky/project` |
| `${git.branch}` | فرع git الحالي أو تجزئة HEAD المختصرة. | `main` |
| `${git.mainBranch}` | الفرع الرئيسي الافتراضي، عادةً ما يُستخدم كهدف PR أو الدمج. | `main` |
| `${git.userName}` | اسم git `user.name` الحالي. | `Sky` |
| `${git.status}` | مخرجات `git status --short`. | `M src/index.ts` |
| `${git.recentCommits}` | ملخص الالتزامات الأخيرة. | `abc1234 Fix prompt builder` |

## الذاكرة

تصف متغيرات الذاكرة دليل الذاكرة المستمر المستند إلى الملفات. يتم حل `${memory.dir}` من استبدال `CC_MEMORY_DIR` / `CLAUDE_MEMORY_DIR` عند التعيين؛ وإلا يتم حسابه كـ `<home>/.claude/projects/<slug>/memory/`، حيث `<slug>` هو دليل العمل الأساسي مع استبدال كل حرف غير أبجدي رقمي بـ `-`. يحتوي `${memory.index}` على محتويات `MEMORY.md` داخل هذا الدليل (الفهرس المحمل في كل جلسة)، ويُبلغ `${memory.enabled}` عما إذا كانت الذاكرة متاحة. يتم تجميع الأقسام `# Memory` و `# Memory index` فقط عند تفعيل الذاكرة.

| Variable | Description | Example |
|---|---|---|
| `${memory.dir}` | دليل الذاكرة المحلول. | `/Users/sky/.claude/projects/-Users-sky-project/memory/` |
| `${memory.index}` | محتويات `MEMORY.md` أو `""` عند غيابها. | `# Memory index\n- [Commit to main](commit-to-main.md) — hook` |
| `${memory.enabled}` | ما إذا كانت الذاكرة متاحة كسلسلة. | `true` |

## المفكرة

دليل المفكرة خاص بالجلسة ولا يعتمد على نظام التشغيل ويجب إدراجه عبر استبدال `CC_SCRATCHPAD_DIR` / `CLAUDE_SCRATCHPAD_DIR`. عند عدم التعيين، يتم الرجوع إلى `""`، والقسم `# Scratchpad Directory` محذوف من التجميع.

| Variable | Description | Example |
|---|---|---|
| `${scratchpad.dir}` | دليل مؤقت خاص بالجلسة الحالية. | `/private/tmp/claude-501/<slug>/<session>/scratchpad` |
