# SuggestSkills

แสดงการ์ดของ standalone skill ที่ผู้ใช้เพิ่มได้ (skill ที่ยังไม่เปิดใช้งาน) ตาม keyword หัวข้อ

## เมื่อใดควรใช้

- คำขอของผู้ใช้ตรงกับ skill ที่พวกเขายังไม่เปิดใช้งาน (`trigger="user_asked"` เมื่อพวกเขาถาม, `trigger="proactive"` เมื่อคุณเสนอเองโดยไม่ถูกขอ)

## การเปิดใช้งาน

- เฉพาะเมื่อไคลเอนต์ Remote Control เชื่อมต่ออยู่ หรือเซสชันทำงานในสภาพแวดล้อมคลาวด์ที่จัดการ
- ปิดใช้งานภายใต้การตั้งค่า HIPAA ขององค์กร
- ไม่มีใน brief mode

## พารามิเตอร์

- `keywords` (array of strings, required): keyword หัวข้อจากคำขอของผู้ใช้ 1–8 รายการ แต่ละรายการ 1–64 ตัวอักษร
- `contextLabel` (string, optional): ป้ายสั้น ๆ ที่ผูกข้อเสนอเข้ากับคำขอ (ไม่เกิน 128 ตัวอักษร)
- `trigger` (string, optional): ข้อเสนอนี้เริ่มขึ้นอย่างไร — `user_asked` หรือ `proactive`

## ตัวอย่าง

### ตัวอย่างที่ 1: เสนอ skill ตามหัวข้อ

```
SuggestSkills(keywords=["data visualization", "charts"], contextLabel="For building the dashboard", trigger="user_asked")
```

skill ที่เปิดใช้งานอยู่แล้วจะถูกกรองออกจากผลลัพธ์

## หมายเหตุ

- แสดงเพียงการ์ดข้อเสนอ — การเพิ่ม skill เกิดขึ้นแยกต่างหาก เรียก `ListSkills` หลังจากนั้นเพื่อยืนยัน
