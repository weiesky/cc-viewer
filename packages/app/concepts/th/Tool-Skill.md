# Skill

Invoke skill ที่มีชื่อภายใน conversation ปัจจุบัน Skill คือชุดความสามารถที่จัดทำไว้ล่วงหน้า — ความรู้โดเมน, workflow, และบางครั้งการเข้าถึง tool — ที่ harness expose ไปยังผู้ช่วยผ่าน system reminder

## เมื่อใดควรใช้

- ผู้ใช้พิมพ์ slash command เช่น `/review` หรือ `/init` — slash command คือ skill และต้องถูกรันผ่าน tool นี้
- ผู้ใช้อธิบายงานที่ match เงื่อนไข trigger ของ skill ที่ advertise (เช่น ขอสแกน transcript หา permission prompt ที่ซ้ำกัน match `fewer-permission-prompts`)
- เป้าหมายของ skill ตรงกับไฟล์ คำขอ หรือ context ของ conversation ในปัจจุบัน
- Workflow เฉพาะทางที่ทำซ้ำได้มีเป็น skill และวิธีมาตรฐานดีกว่าวิธีเฉพาะหน้า
- ผู้ใช้ถาม "มี skill อะไรบ้าง" — ระบุชื่อที่ advertise และ invoke เฉพาะเมื่อพวกเขายืนยัน

## พารามิเตอร์

- `skill` (string, required): ชื่อที่แน่นอนของ skill ที่อยู่ใน system reminder available-skill ปัจจุบัน สำหรับ skill ที่เป็น plugin-namespaced ใช้ในรูปแบบเต็ม `plugin:skill` (เช่น `skill-creator:skill-creator`) อย่าใส่ slash นำหน้า
- `args` (string, optional): argument แบบ free-form ที่ส่งไปยัง skill รูปแบบและความหมายถูกกำหนดโดย documentation ของ skill แต่ละตัว

## ตัวอย่าง

### ตัวอย่างที่ 1: รัน skill review บน branch ปัจจุบัน

```
Skill(skill="review")
```

Skill `review` รวบรวมขั้นตอนสำหรับ review pull request กับ base branch ปัจจุบัน การ invoke จะโหลดกระบวนการ review ที่กำหนดโดย harness เข้าสู่ turn

### ตัวอย่างที่ 2: Invoke skill ที่เป็น plugin-namespaced พร้อม argument

```
Skill(
  skill="skill-creator:skill-creator",
  args="create a skill that summarizes git log for a given date range"
)
```

Route คำขอผ่าน entry point ของ plugin `skill-creator` เพื่อให้ workflow การสร้าง skill เริ่มต้น

## หมายเหตุ

- Invoke เฉพาะ skill ที่มีชื่อปรากฏตามตัวอักษรใน system reminder available-skill หรือ skill ที่ผู้ใช้พิมพ์โดยตรงเป็น `/name` ในข้อความ อย่าเดาหรือคิด skill name จาก memory หรือ training data — หาก skill ไม่ได้ advertise อย่าเรียก tool นี้
- เมื่อคำขอของผู้ใช้ match skill ที่ advertise การเรียก `Skill` เป็นข้อกำหนดที่ blocking: invoke มันก่อนสร้างการตอบอื่นๆ เกี่ยวกับงาน อย่าอธิบายสิ่งที่ skill จะทำ — รันมัน
- อย่ากล่าวถึง skill ด้วยชื่อโดยไม่ invoke จริงๆ การประกาศ skill โดยไม่เรียก tool เป็นการหลอกลวง
- อย่าใช้ `Skill` สำหรับ built-in CLI command เช่น `/help`, `/clear`, `/model`, หรือ `/exit` สิ่งเหล่านี้ถูกจัดการโดย harness โดยตรง
- อย่า re-invoke skill ที่กำลังรันอยู่ใน turn ปัจจุบัน หากคุณเห็นแท็ก `<command-name>` ใน turn ปัจจุบัน skill ถูกโหลดแล้ว — ทำตามคำสั่งแทนการเรียก tool อีกครั้ง
- หาก skill หลายตัวอาจใช้ได้ ให้เลือกตัวที่เฉพาะเจาะจงที่สุด สำหรับการเปลี่ยน configuration เช่น การเพิ่ม permission หรือ hook ชอบ `update-config` มากกว่าวิธีการตั้งค่าทั่วไป
- การ execute skill อาจแนะนำ system reminder, tool, หรือข้อจำกัดใหม่สำหรับส่วนที่เหลือของ turn อ่าน conversation state อีกครั้งหลัง skill เสร็จก่อนดำเนินการต่อ
