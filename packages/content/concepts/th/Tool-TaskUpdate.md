# TaskUpdate

แก้ไข task ที่มีอยู่ — สถานะ, เนื้อหา, ownership, metadata, หรือ dependency edge นี่คือวิธีที่ task ก้าวหน้าผ่าน lifecycle และวิธีที่งานถูกส่งต่อระหว่าง Claude Code, teammate, และ subagent

## เมื่อใดควรใช้

- เปลี่ยน task ผ่าน workflow สถานะขณะที่คุณทำงานบนมัน
- อ้างสิทธิ์ task โดยกำหนดตัวเอง (หรือ agent อื่น) เป็น `owner`
- ปรับแต่ง `subject` หรือ `description` เมื่อคุณเรียนรู้เพิ่มเกี่ยวกับปัญหา
- บันทึก dependency ที่เพิ่งค้นพบด้วย `addBlocks` / `addBlockedBy`
- แนบ `metadata` ที่มีโครงสร้าง เช่น external ticket ID หรือ hint ลำดับความสำคัญ

## การเปิดใช้งาน

- พร้อมใช้งานตามค่าเริ่มต้นในโมเดลส่วนใหญ่
- ไม่พร้อมใช้งานในตระกูล Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 และใหม่กว่า (v2.1.233+) เว้นแต่เปิดใช้งานผ่าน `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools`, หรือ `--tools`
- ระบบ task ทั้งหมดถูกปิดใช้งานเมื่อ `CLAUDE_CODE_ENABLE_TASKS=false`

## พารามิเตอร์

- `taskId` (string, required): Task ที่จะแก้ไข รับจาก `TaskList` หรือ `TaskCreate`
- `status` (string, optional): หนึ่งใน `pending`, `in_progress`, `completed`, `deleted`
- `subject` (string, optional): หัวข้อคำสั่งที่แทนที่
- `description` (string, optional): description ละเอียดที่แทนที่
- `activeForm` (string, optional): ข้อความ spinner ปัจจุบันกาลต่อเนื่องที่แทนที่
- `owner` (string, optional): handle ของ agent หรือ teammate ที่รับผิดชอบ task
- `metadata` (object, optional): Metadata key ที่ merge เข้า task ตั้งค่า key เป็น `null` เพื่อลบ
- `addBlocks` (array of strings, optional): Task ID ที่ task นี้ block
- `addBlockedBy` (array of strings, optional): Task ID ที่ต้องเสร็จก่อนตัวนี้

## Workflow สถานะ

Lifecycle เป็นเส้นตรงอย่างจงใจ: `pending` → `in_progress` → `completed` `deleted` เป็น terminal และใช้เพื่อ retract task ที่จะไม่ทำ

- ตั้ง `in_progress` ณ ขณะที่คุณเริ่มงานจริง ไม่ใช่ก่อน มีเพียง task เดียวในแต่ละครั้งควรเป็น `in_progress` สำหรับ owner ที่กำหนด
- ตั้ง `completed` เฉพาะเมื่องานเสร็จสมบูรณ์ — acceptance criteria พบแล้ว, test ผ่าน, output เขียน หาก blocker ปรากฏ ให้คง task เป็น `in_progress` และเพิ่ม task ใหม่อธิบายสิ่งที่ต้องแก้
- อย่า mark task เป็น `completed` เมื่อ test ล้มเหลว, implementation เป็นบางส่วน, หรือคุณพบ error ที่ยังไม่แก้
- ใช้ `deleted` สำหรับ task ที่ยกเลิกหรือซ้ำ; อย่าเปลี่ยนจุดประสงค์ task สำหรับงานที่ไม่เกี่ยวข้อง

## ตัวอย่าง

### ตัวอย่างที่ 1

อ้างสิทธิ์ task และเริ่ม

```
TaskUpdate(
  taskId: "t_01HXYZ...",
  status: "in_progress",
  owner: "main-agent"
)
```

### ตัวอย่างที่ 2

จบงานและบันทึก dependency follow-up

```
TaskUpdate(
  taskId: "t_01HXYZ...",
  status: "completed"
)

TaskUpdate(
  taskId: "t_01FOLLOWUP...",
  addBlockedBy: ["t_01HXYZ..."]
)
```

## หมายเหตุ

- `metadata` merge ทีละ key; ส่ง `null` สำหรับ key จะลบ เรียก `TaskGet` ก่อนหากไม่แน่ใจเนื้อหาปัจจุบัน
- `addBlocks` และ `addBlockedBy` เพิ่ม edge; ไม่ลบของเดิม การแก้ graph แบบทำลายต้องใช้ workflow เฉพาะ — ปรึกษา owner ของทีมก่อนเขียน dependency ใหม่
- รักษา `activeForm` ให้ sync เมื่อคุณเปลี่ยน `subject` เพื่อให้ข้อความ spinner ยังอ่านเป็นธรรมชาติ
- อย่า mark task เป็น `completed` เพื่อปิดเสียง หากผู้ใช้ยกเลิกงาน ให้ใช้ `deleted` พร้อมเหตุผลสั้นใน `description`
- อ่านสถานะล่าสุดของ task ด้วย `TaskGet` ก่อนอัปเดต — teammate อาจเปลี่ยนมันระหว่างการอ่านครั้งก่อนและการเขียนของคุณ
