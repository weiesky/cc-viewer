# SuggestConnectors

ดึงรายละเอียด connector แบบเต็มสำหรับค่า `directoryUuid` ที่ส่งคืนโดย `SearchMcpRegistry` เพื่อให้ผู้ใช้ได้รับข้อเสนอ connector ที่เป็นรูปธรรมให้เปิดใช้งาน

## เมื่อใดควรใช้

- หลังจาก `SearchMcpRegistry` ส่งคืน connector ที่เป็นตัวเลือก เพื่อดึงรายละเอียดแบบเต็มมาแสดง

## พารามิเตอร์

- `uuids` (array of strings, required): ค่า `directoryUuid` หรือ `server_id` ที่จะดึงรายละเอียด 1–32 รายการ แต่ละรายการ 1–64 ตัวอักษร

## ตัวอย่าง

### ตัวอย่างที่ 1: ดึงรายละเอียดผลการค้นหา registry สองรายการ

```
SuggestConnectors(uuids=["d290f1ee-6c54-4b01-90e6-d701748f0851", "a1b2c3d4-0000-4000-8000-abcdefabcdef"])
```

## หมายเหตุ

- อย่าเดา UUID — ดึงรายละเอียดเฉพาะ identifier ที่ส่งคืนมาจาก `SearchMcpRegistry` เท่านั้น
- เครื่องมือนี้ไม่ได้เชื่อมต่ออะไรเอง การเปิดใช้งาน connector เกิดขึ้นแยกต่างหาก
- มีเฉพาะในเซสชันระยะไกล (claude.ai) บน first-party API เท่านั้น
