# systemPromptModel.md variables

ไฟล์นี้เอกสารเฉพาะตัวแปรใน `systemPromptModel.md` ที่ต้องแก้ไขในขณะรันไทม์ ตัวแปรแต่ละตัวแก้ไขเป็นสตริง ตัวเลข หรือสตริงว่าง `""`; เมื่อไม่สามารถรับค่าได้ ค่านั้นจะย้อนกลับอย่างสม่ำเสมอเป็นสตริงว่าง

## พื้นที่ทำงานและสภาพแวดล้อมผู้ใช้

| Variable | Description | Example |
|---|---|---|
| `${environment.cwd}` | ไดเรกทอรี่ทำงานหลักปัจจุบัน | `/Users/sky/claude-code` |
| `${environment.originalCwd}` | ไดเรกทอรี่ทำงานดั้งเดิมเมื่อกระบวนการ/เซสชันเริ่มต้น | `/Users/sky/claude-code` |
| `${environment.home}` | ไดเรกทอรี่บ้านของผู้ใช้ ใช้สำหรับแก้ไข `~` | `/Users/sky` |
| `${environment.user}` | ชื่อผู้ใช้ระบบปัจจุบัน | `sky` |
| `${environment.workspaceRoots}` | รากของพื้นที่ทำงานสำหรับเซสชันปัจจุบัน; อาจแสดงเป็นสตริงที่คั่นด้วยการขึ้นบรรทัดใหม่ | `/Users/sky/claude-code` |
| `${environment.path}` | PATH ของกระบวนการปัจจุบัน | `/opt/homebrew/bin:/usr/bin:/bin` |
| `${environment.lang}` | ท้องถิ่นปัจจุบันหรือสภาพแวดล้อมของภาษา | `zh_CN.UTF-8` |

## ระบบปฏิบัติการ

| Variable | Description | Example |
|---|---|---|
| `${os.platform}` | แพลตฟอร์มตามที่ระบุโดย Node.js | `darwin` |
| `${os.type}` | ประเภทระบบปฏิบัติการ | `Darwin` |
| `${os.arch}` | สถาปัตยกรรม CPU | `arm64` |
| `${os.shell}` | เชลล์ปัจจุบัน | `/bin/zsh` |
| `${os.version}` | คำอธิบายเวอร์ชันระบบปฏิบัติการ | `Darwin Kernel Version ...` |
| `${os.release}` | รุ่นระบบปฏิบัติการ | `24.5.0` |
| `${os.hostname}` | ชื่อโฮสต์ปัจจุบัน | `MacBook-Pro.local` |
| `${os.availableParallelism}` | ความสามารถในการประมวลผลแบบขนาน | `10` |
| `${os.totalMemory}` | หน่วยความจำของระบบทั้งหมด เป็นไบต์ | `34359738368` |
| `${os.freeMemory}` | หน่วยความจำว่าง เป็นไบต์ | `8589934592` |
| `${os.uptime}` | เวลาทำงานของระบบ เป็นวินาที | `123456` |

## Runtime Node.js

| Variable | Description | Example |
|---|---|---|
| `${runtime.nodeVersion}` | เวอร์ชัน Node.js ปัจจุบัน | `v24.14.0` |
| `${runtime.execPath}` | พาธไปยังไฟล์ปฏิบัติการ Node.js ปัจจุบัน | `/opt/homebrew/bin/node` |
| `${runtime.pid}` | ID ของกระบวนการปัจจุบัน | `12345` |
| `${runtime.ppid}` | ID ของกระบวนการหลัก | `1234` |

## เวลา

| Variable | Description | Example |
|---|---|---|
| `${time.current}` | สตริงเวลาท้องถิ่นปัจจุบัน | `Thu Jul 09 2026 18:22:09 GMT+0800 (China Standard Time)` |
| `${time.iso}` | เวลา ISO ปัจจุบัน | `2026-07-09T10:22:09.000Z` |
| `${time.date}` | วันที่ท้องถิ่นปัจจุบัน | `2026-07-09` |
| `${time.timezone}` | โซนเวลาของระบบปัจจุบัน | `Asia/Shanghai` |

## สิทธิและแซนด์บ็อกซ์

| Variable | Description | Example |
|---|---|---|
| `${permissions.mode}` | โหมดสิทธิของเครื่องมือปัจจุบัน | `default` |
| `${permissions.approvalsReviewer}` | นโยบายการอนุมัติหรือโหมดผู้ตรวจสอบปัจจุบัน | `auto_review` |
| `${sandbox.mode}` | โหมดแซนด์บ็อกซ์ของระบบไฟล์ | `workspace-write` |
| `${sandbox.networkAccess}` | สถานะการเข้าถึงเครือข่าย | `enabled` |
| `${sandbox.writableRoots}` | ไดเรกทอรี่ที่แซนด์บ็อกซ์อนุญาตให้เขียน; อาจแสดงเป็นสตริงที่คั่นด้วยการขึ้นบรรทัดใหม่ | `/Users/sky/Documents/Playground` |

## เทอร์มินัล

| Variable | Description | Example |
|---|---|---|
| `${terminal.term}` | TERM ปัจจุบัน | `xterm-256color` |
| `${terminal.colorTerm}` | COLORTERM ปัจจุบัน | `truecolor` |
| `${terminal.columns}` | จำนวนคอลัมน์เทอร์มินัลปัจจุบัน | `120` |
| `${terminal.rows}` | จำนวนแถวเทอร์มินัลปัจจุบัน | `40` |

## ระบบไฟล์

| Variable | Description | Example |
|---|---|---|
| `${filesystem.tmpdir}` | ไดเรกทอรี่ชั่วคราวของระบบ | `/var/folders/.../T` |
| `${filesystem.pathSeparator}` | ตัวคั่นพาธไฟล์ | `/` |
| `${filesystem.pathDelimiter}` | ตัวคั่นรายการ PATH | `:` |

## โมเดล

| Variable | Description | Example |
|---|---|---|
| `${model.name}` | ชื่อหรือ ID ของโมเดลปัจจุบัน | `claude-opus-4-6` |
| `${model.knowledgeCutoff}` | ขีดจำกัดความรู้ของโมเดลปัจจุบัน; ค่านี้ไม่สามารถได้มาจากระบบปฏิบัติการและต้องได้รับการฉีดผ่านการตั้งค่าภายนอกหรือการแทนที่ | `May 2025` |

## Git

| Variable | Description | Example |
|---|---|---|
| `${git.isRepository}` | ว่าไดเรกทอรี่ปัจจุบันอยู่ภายในรีโปซิทอรี่ git หรือไม่ เป็นสตริง | `true` |
| `${git.root}` | ไดเรกทอรี่รูทของรีโปซิทอรี่ git | `/Users/sky/project` |
| `${git.branch}` | บรานช์ git ปัจจุบันหรือแฮช HEAD สั้น | `main` |
| `${git.mainBranch}` | บรานช์หลักเริ่มต้น มักใช้เป็นเป้าหมาย PR หรือการผสาน | `main` |
| `${git.userName}` | `user.name` ของ git ปัจจุบัน | `Sky` |
| `${git.status}` | ผลลัพธ์ของ `git status --short` | `M src/index.ts` |
| `${git.recentCommits}` | สรุปของคอมมิตล่าสุด | `abc1234 Fix prompt builder` |

## หน่วยความจำ

ตัวแปรหน่วยความจำอธิบายไดเรกทอรี่หน่วยความจำที่ยังคงอยู่บนไฟล์ `${memory.dir}` จะแก้ไขจากการแทนที่ `CC_MEMORY_DIR` / `CLAUDE_MEMORY_DIR` เมื่อตั้งค่า; มิฉะนั้นจะคำนวณเป็น `<home>/.claude/projects/<slug>/memory/` โดยที่ `<slug>` คือไดเรกทอรี่ทำงานหลักโดยแต่ละอักขระที่ไม่ใช่อักษรตัวเลขจะถูกแทนที่ด้วย `-` `${memory.index}` เก็บเนื้อหาของ `MEMORY.md` ในไดเรกทอรี่นั้น (ดัชนีที่โหลดในแต่ละเซสชัน) และ `${memory.enabled}` รายงานว่าหน่วยความจำพร้อมใช้งานหรือไม่ ส่วน `# Memory` และ `# Memory index` จะประกอบอยู่ก็ต่อเมื่อเปิดใช้งานหน่วยความจำ

| Variable | Description | Example |
|---|---|---|
| `${memory.dir}` | ไดเรกทอรี่หน่วยความจำที่ได้รับการแก้ไข | `/Users/sky/.claude/projects/-Users-sky-project/memory/` |
| `${memory.index}` | เนื้อหาของ `MEMORY.md` หรือ `""` เมื่อขาดหายไป | `# Memory index\n- [Commit to main](commit-to-main.md) — hook` |
| `${memory.enabled}` | ว่าหน่วยความจำพร้อมใช้งาน เป็นสตริง | `true` |

## สแคร์ปแพด

ไดเรกทอรี่สแคร์ปแพดเฉพาะเซสชันและไม่สามารถได้มาจากระบบปฏิบัติการ ต้องฉีดผ่านการแทนที่ `CC_SCRATCHPAD_DIR` / `CLAUDE_SCRATCHPAD_DIR` เมื่อไม่ตั้งค่าไว้ ค่านั้นจะย้อนกลับเป็น `""` และส่วน `# Scratchpad Directory` จะถูกละเว้นจากการประกอบ

| Variable | Description | Example |
|---|---|---|
| `${scratchpad.dir}` | ไดเรกทอรี่ชั่วคราวเฉพาะเซสชัน | `/private/tmp/claude-501/<slug>/<session>/scratchpad` |
