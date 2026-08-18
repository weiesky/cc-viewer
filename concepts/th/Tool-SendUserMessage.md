# SendUserMessage

ส่งข้อความถึงผู้ใช้ — ช่องสัญญาณเอาต์พุตหลักที่มองเห็นได้ในเซสชันแบบ brief-style หรือที่รู้จักใน alias รุ่นเดิมว่า `Brief`

## เมื่อใดควรใช้

- ตอบกลับสิ่งที่ผู้ใช้เพิ่งพูด (`status="normal"`)
- นำเสนอล่วงหน้าสิ่งที่ผู้ใช้ยังไม่ได้ขอและต้องเห็นตอนนี้ — งานเสร็จในขณะที่พวกเขาไม่อยู่, อุปสรรคที่คุณพบ, การอัปเดตสถานะที่ไม่ได้ร้องขอ (`status="proactive"`)

## พารามิเตอร์

ใน brief mode:

- `message` (string, required): ข้อความถึงผู้ใช้ รองรับการจัดรูปแบบ markdown
- `attachments` (array, optional): ไฟล์แนบที่แสดงพร้อมข้อความ แต่ละรายการเป็น path ไฟล์ (absolute หรือ relative กับ cwd) สำหรับไฟล์ที่อ่านได้ในเครื่อง หรือ object `{file_uuid, file_name, size, is_image}` ที่ resolve ไว้แล้วซึ่งได้จาก device tool เช่น `attach_file`
- `status` (string, required): `proactive` สำหรับการอัปเดตที่ไม่ได้ร้องขอซึ่งผู้ใช้ต้องรู้ตอนนี้ ส่วน `normal` เมื่อตอบกลับผู้ใช้

ใน build ที่ไม่ใช่ brief มีเฉพาะ `message` เท่านั้น

## ตัวอย่าง

### ตัวอย่างที่ 1: ประกาศความสำเร็จแบบ proactive

```
SendUserMessage(
  message="The migration finished — 42 files updated, tests green.",
  status="proactive"
)
```

## หมายเหตุ

- เปิดใช้งานเฉพาะใน brief mode หรือผ่าน feature rollout ที่เกี่ยวข้อง CLI เซสชันแบบ interactive ส่วนใหญ่คุยกับผู้ใช้โดยตรงแทน
- ใช้ `proactive` อย่างประหยัด — มีไว้สำหรับสิ่งที่ต้องดึงความสนใจผู้ใช้จริง ๆ ตอนนี้
