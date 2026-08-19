# TaskCreate

สร้าง task ใหม่ใน task list ของทีมปัจจุบัน (หรือ task list ของ session เมื่อไม่มีทีม active) ใช้เพื่อจับรายการงานที่ควรได้รับการติดตาม มอบหมาย หรือกลับมาดูภายหลัง

## เมื่อใดควรใช้

- ผู้ใช้อธิบายงานหลายขั้นตอนที่ได้ประโยชน์จากการติดตามที่ชัดเจน
- คุณกำลังแบ่งคำขอขนาดใหญ่เป็นหน่วยย่อยที่สามารถเสร็จสิ้นแยกกันได้
- มีการค้นพบ follow-up ระหว่างงานและไม่ควรถูกลืม
- คุณต้องการบันทึกเจตนาที่คงทนก่อนส่งงานให้ teammate หรือ subagent
- คุณกำลังทำงานใน plan mode และต้องการให้แต่ละขั้นตอนของแผนแสดงเป็น task ที่เป็นรูปธรรม

ข้าม `TaskCreate` สำหรับการกระทำ one-shot ธรรมดา การสนทนาล้วนๆ หรือสิ่งใดก็ตามที่ทำเสร็จได้ในสองหรือสามการเรียก tool โดยตรง

## การเปิดใช้งาน

- พร้อมใช้งานตามค่าเริ่มต้นในโมเดลส่วนใหญ่
- ไม่พร้อมใช้งานในตระกูล Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 และใหม่กว่า (v2.1.233+) เว้นแต่เปิดใช้งานผ่าน `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools`, หรือ `--tools`
- ระบบ task ทั้งหมดถูกปิดใช้งานเมื่อ `CLAUDE_CODE_ENABLE_TASKS=false`

## พารามิเตอร์

- `subject` (string, required): หัวข้อสั้นในรูปคำสั่ง เช่น `Fix login redirect on Safari` รักษาความยาวไม่เกินประมาณแปดสิบอักขระ
- `description` (string, required): context ที่ละเอียด — ปัญหา ข้อจำกัด acceptance criteria และไฟล์หรือลิงก์ที่ผู้อ่านในอนาคตจะต้องการ เขียนราวกับว่า teammate จะรับงานเย็นๆ
- `activeForm` (string, optional): ข้อความ spinner ในรูปปัจจุบันกาลต่อเนื่องที่แสดงขณะที่ task เป็น `in_progress` เช่น `Fixing login redirect on Safari` สะท้อน `subject` แต่ในรูป -ing
- `metadata` (object, optional): ข้อมูลโครงสร้างแบบกำหนดเองที่แนบกับ task ใช้ทั่วไป: label, hint ลำดับความสำคัญ, external ticket ID, หรือ configuration เฉพาะ agent

Task ที่สร้างใหม่จะเริ่มด้วยสถานะ `pending` และไม่มี owner Dependency (`blocks`, `blockedBy`) ไม่ได้ตั้งค่าในตอนสร้าง — ใช้ภายหลังด้วย `TaskUpdate`

## ตัวอย่าง

### ตัวอย่างที่ 1

จับรายงานบั๊กที่ผู้ใช้เพิ่งยื่น

```
TaskCreate(
  subject: "Repair broken PDF export on Windows",
  description: "Users on Windows 11 report the export button produces a 0-byte file. Reproduce with sample doc in test/fixtures/export/, then fix the code path in src/export/pdf.ts. Acceptance: export writes a valid PDF and the existing export test suite passes.",
  activeForm: "Repairing broken PDF export on Windows"
)
```

### ตัวอย่างที่ 2

แบ่ง epic เป็นหน่วยติดตามเมื่อเริ่ม session

```
TaskCreate(
  subject: "Draft migration plan for auth service",
  description: "Produce a written plan covering rollout stages, rollback strategy, and monitoring. Output: docs/auth-migration.md.",
  activeForm: "Drafting migration plan for auth service",
  metadata: { "priority": "P1", "linearId": "AUTH-214" }
)
```

## หมายเหตุ

- เขียน `subject` ในรูปคำสั่งและ `activeForm` ในรูปปัจจุบันกาลต่อเนื่อง เพื่อให้ UI อ่านเป็นธรรมชาติเมื่อ task เปลี่ยนเป็น `in_progress`
- เรียก `TaskList` ก่อนสร้างเพื่อหลีกเลี่ยงการซ้ำ — list ของทีมแชร์กับ teammate และ subagent
- อย่าใส่ secret หรือ credential ใน `description` หรือ `metadata`; บันทึก task จะเห็นได้โดยทุกคนที่เข้าถึงทีม
- หลังสร้าง ให้ task ผ่าน lifecycle ด้วย `TaskUpdate` อย่าปล่อยงานให้ถูกละเลยเงียบๆ ใน `in_progress`
