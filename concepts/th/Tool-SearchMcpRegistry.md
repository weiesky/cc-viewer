# SearchMcpRegistry

ค้นหา MCP connector registry ด้วย keyword เพื่อค้นพบ connector ที่อาจช่วยให้งานสำเร็จ

## เมื่อใดควรใช้

- งานจะได้ประโยชน์จากบริการภายนอก (ฐานข้อมูล, issue tracker, SaaS API) และคุณต้องการตรวจสอบว่ามี MCP connector สำหรับบริการนั้นหรือไม่
- ผู้ใช้ระบุชื่อผลิตภัณฑ์และขอให้เชื่อมต่อ — ค้นหา registry เพื่อหา connector ที่ตรงกัน

## การเปิดใช้งาน

- พร้อมใช้งานในเซสชันระยะไกล (claude.ai) บน first-party API เท่านั้น

## พารามิเตอร์

- `keywords` (array of strings, required): วลี keyword ที่อธิบายความตั้งใจของผู้ใช้หรือชื่อผลิตภัณฑ์ 1–8 รายการ แต่ละรายการ 1–64 ตัวอักษร

## ตัวอย่าง

### ตัวอย่างที่ 1: หา connector สำหรับผลิตภัณฑ์ที่ระบุชื่อ

```
SearchMcpRegistry(keywords=["linear", "issue tracker"])
```

ส่งคืนรายการ registry ที่ connector ตรงกับ keyword ดึงรายละเอียด connector แบบเต็มด้วย `SuggestConnectors`

## หมายเหตุ

- อ่านอย่างเดียวและปลอดภัยต่อ concurrency ผลลัพธ์ถูกจำกัดขนาด
- การค้นหาไม่ติดตั้งอะไรเลย — เป็นการค้นพบล้วน ๆ
