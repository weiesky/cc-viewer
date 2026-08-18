# SendFeedback

ส่ง feedback แบบมีโครงสร้างเกี่ยวกับ Claude Code ไปยัง Anthropic — รายงานบั๊ก, ไอเดียฟีเจอร์, หรือความสามารถที่ขาดหาย — โดยไม่ต้องออกจากเซสชัน

## เมื่อใดควรใช้

- ผู้ใช้ขอให้รายงานบั๊กหรือส่ง feedback เกี่ยวกับตัว Claude Code เอง
- คุณพบข้อบกพร่องของผลิตภัณฑ์ที่ชัดเจน (คำสั่งเสีย, พฤติกรรมผิด, แครช) ที่คุ้มค่าต่อการรายงาน
- ผู้ใช้อธิบายฟีเจอร์ที่อยากให้มี (ไอเดียหรือความสามารถที่ขาดหาย)

## พารามิเตอร์

- `type` (string, required): หนึ่งใน `bug`, `idea`, `missing_capability`
- `title` (string, required): สรุปประเด็นหนึ่งบรรทัดที่สั้นและเฉพาะเจาะจง
- `details` (string, required): หัวข้อย่อยแบบ labeled เรียงตามลำดับ: **What happened:** (สิ่งที่สังเกตเทียบกับที่คาดหวัง, ข้อความ error ที่แน่นอนหากสั้น); **What the user said:** (อ้างคำพูด หรือ "User didn't comment; observed by the model."); **Repro:** (ขั้นตอนน้อยที่สุด); **Evidence:** (request ID, timestamp, path, เวอร์ชัน — ละเว้นหากไม่มี); และ **Cause:** เป็นตัวเลือกสุดท้าย เฉพาะเมื่อยืนยันแล้วในเซสชันเท่านั้น หนึ่งถึงสามบรรทัดต่อหัวข้อ ไม่มีย่อหน้าแบบเล่าเรื่อง ไม่มีการคาดเดา ไม่มีความลับ
- `area` (string, optional): แท็กสั้น ๆ ระบุส่วนของ Claude Code ที่เกี่ยวข้อง (เช่น "hooks config", "/help", "file editing") เว้นว่างหากไม่ชัดเจน
- `failure_mode` (string, optional): สำหรับรายงานพฤติกรรมของโมเดล ให้ระบุ failure mode ที่ใกล้เคียงที่สุด (เช่น `instruction_following`, `repetition_and_looping`, `context_and_memory`, `stopping_short`, หรือ `other`) ละเว้นเฉพาะเมื่อรายงานเป็นบั๊กของผลิตภัณฑ์/tool ล้วน ๆ
- `task_category` (string, optional): สิ่งที่เซสชันกำลังทำอยู่เมื่อเกิดปัญหา: `code_edit`, `debug`, `explain`, `plan`, `shell`, `search`, `review`, หรือ `other`

## ตัวอย่าง

### ตัวอย่างที่ 1: รายงานบั๊กของผลิตภัณฑ์

```
SendFeedback(
  type="bug",
  title="/export truncates the last message",
  details="**What happened:** exported transcript is missing the final assistant message.\n**What the user said:** \"the last reply never shows up in the file\".\n**Repro:** run /export after any multi-turn session.\n**Evidence:** v2.1.233, macOS.",
  area="/export",
  task_category="other"
)
```

## หมายเหตุ

- อย่าใส่ความลับ, token, หรือข้อมูลส่วนตัวของผู้ใช้ใน `details`
- อ้างคำพูดของผู้ใช้เมื่อมี หากไม่มีให้ระบุว่าโมเดลเป็นผู้สังเกตเห็นปัญหา
- ทำให้รายงานเป็นข้อเท็จจริง — การคาดเดาสาเหตุรากอยู่ที่ `**Cause:**` เฉพาะเมื่อยืนยันแล้วในเซสชันเท่านั้น
