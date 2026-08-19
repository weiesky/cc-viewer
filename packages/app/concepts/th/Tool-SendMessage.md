# SendMessage

ส่งข้อความจากสมาชิกทีมหนึ่งไปยังอีกคนหนึ่งภายในทีมที่ active หรือ broadcast ไปยัง teammate ทุกคนในคราวเดียว นี่เป็นช่องทางเดียวที่ teammate สามารถได้ยิน — สิ่งใดๆ ที่เขียนลงใน text output ปกติจะไม่มองเห็นสำหรับพวกเขา

## เมื่อใดควรใช้

- มอบหมายงานหรือส่งต่อ subproblem ให้ teammate ที่มีชื่อระหว่างการทำงานร่วมกันเป็นทีม
- ขอสถานะ ผลลัพธ์ระหว่างทาง หรือ code review จาก agent อื่น
- Broadcast การตัดสินใจ ข้อจำกัดร่วมกัน หรือประกาศการปิดระบบไปยังทั้งทีมผ่าน `*`
- ตอบกลับ protocol prompt เช่นคำขอ shutdown หรือคำขอ plan approval จาก team leader
- ปิดลูปที่จุดสิ้นสุดของงานที่มอบหมาย เพื่อให้ leader สามารถ mark รายการว่าเสร็จแล้ว

## การเปิดใช้งาน

- Gated ด้วยเงื่อนไขการส่งข้อความข้ามเซสชันเดียวกับ `ListAgents` (feature flag ฝั่ง server ปิดตามค่าเริ่มต้น)
- Teammate ต้องเปิดใช้งาน experimental agent teams เพิ่มเติมด้วย

## พารามิเตอร์

- `to` (string, required): `name` ของ teammate เป้าหมายตามที่ลงทะเบียนในทีม หรือ `*` เพื่อ broadcast ไปยัง teammate ทุกคนในคราวเดียว
- `message` (string หรือ object, required): ข้อความธรรมดาสำหรับการสื่อสารปกติ หรือ object ที่มีโครงสร้างสำหรับการตอบ protocol เช่น `shutdown_response` และ `plan_approval_response`
- `summary` (string, optional): preview 5–10 คำที่แสดงใน team activity log สำหรับข้อความ plain-text จำเป็นสำหรับข้อความ string ยาว; ถูกละเลยเมื่อ `message` เป็น protocol object

## ตัวอย่าง

### ตัวอย่างที่ 1: ส่งต่องานโดยตรง

```
SendMessage(
  to="db-lead",
  message="Please audit prisma/schema.prisma and list any model missing createdAt/updatedAt timestamps. Reply when done.",
  summary="Audit schema for missing timestamps"
)
```

### ตัวอย่างที่ 2: Broadcast ข้อจำกัดร่วมกัน

```
SendMessage(
  to="*",
  message="Reminder: do not touch files under legacy/ — that subtree is frozen until the migration PR lands.",
  summary="Freeze legacy/ during migration"
)
```

### ตัวอย่างที่ 3: การตอบ protocol

ตอบกลับคำขอ shutdown จาก leader โดยใช้ข้อความที่มีโครงสร้าง:

```
SendMessage(
  to="leader",
  message={ "type": "shutdown_response", "ready": true, "final_report": "All assigned diff chunks committed on branch refactor-crew/db-lead." }
)
```

### ตัวอย่างที่ 4: การตอบ plan approval

```
SendMessage(
  to="leader",
  message={ "type": "plan_approval_response", "approved": true, "notes": "LGTM, but please split step 4 into migration + backfill." }
)
```

## หมายเหตุ

- Assistant text output ปกติของคุณจะไม่ถูกส่งไปยัง teammate หากคุณต้องการให้ agent อื่นเห็นบางอย่าง มันต้องผ่าน `SendMessage` นี่คือความผิดพลาดที่พบบ่อยที่สุดใน team workflow
- Broadcast (`to: "*"`) แพง — มันปลุก teammate ทุกคนและใช้ context ของพวกเขา สงวนไว้สำหรับประกาศที่ส่งผลกระทบต่อทุกคนจริงๆ ชอบการส่งแบบเฉพาะเจาะจง
- รักษาข้อความให้กระชับและเน้นการกระทำ รวม path ของไฟล์ ข้อจำกัด และ format การตอบที่คาดหวังที่ผู้รับต้องการ; จำไว้ว่าพวกเขาไม่มีความจำร่วมกับคุณ
- Protocol message object (`shutdown_response`, `plan_approval_response`) มีรูปร่างที่แน่นอน อย่ามี protocol field ผสมเข้าไปในข้อความ plain-text หรือกลับกัน
- ข้อความเป็นแบบ asynchronous ผู้รับจะได้รับของคุณในรอบถัดไป; อย่าถือว่าพวกเขาได้อ่านหรือลงมือทำจนกว่าจะตอบกลับ
- `summary` ที่เขียนดีทำให้ team activity log สแกนได้ง่ายสำหรับ leader — ถือเหมือนบรรทัด subject ของ commit
