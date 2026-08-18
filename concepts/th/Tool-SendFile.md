# SendFile

ส่งไฟล์หนึ่งไฟล์ขึ้นไปไปยังเซสชันของ Claude Code อื่น — peer ที่แสดงใน `ListAgents` หรือที่อยู่เซสชันแบบชัดเจน

## เมื่อใดควรใช้

- peer session ต้องการไฟล์จาก working directory ของคุณ (รายงาน, patch, fixture) เพื่อทำงานของมันต่อ
- คุณประสานงานข้ามเซสชันและต้องการส่งมอบ artifact ไม่ใช่แค่ข้อความ (ใช้ `SendMessage` สำหรับข้อความ)

## การเปิดใช้งาน

- การโอนไฟล์ข้ามเซสชันต้องพร้อมใช้งานในเซสชัน หากไม่ การตรวจสอบจะล้มเหลวพร้อมข้อความ "Cross-session file transfer is not available in this session."
- Gated ด้วยเงื่อนไขการส่งข้อความข้ามเซสชันเดียวกับ `ListAgents` (feature flag ฝั่ง server ปิดตามค่าเริ่มต้น)

## พารามิเตอร์

- `to` (string, required): ผู้รับ — ชื่อ peer session จาก `ListAgents` หรือที่อยู่แบบ `uds:<socket>` / `bridge:<session id>` ที่ชัดเจน
- `files` (array of strings, required): path ของไฟล์ (absolute หรือ relative กับ cwd) ที่จะส่ง ต้องส่งเป็น array เสมอแม้มีไฟล์เดียว 1–16 ไฟล์ แต่ละไฟล์ไม่เกิน 30 MiB
- `message` (string, optional): ข้อความสั้น ๆ ที่ส่งไปพร้อมกับไฟล์

## ตัวอย่าง

### ตัวอย่างที่ 1: ส่งรายงานไปยัง peer session

```
SendFile(
  to="teammate-a",
  files=["./dist/report.html"],
  message="The analysis you asked for"
)
```

## หมายเหตุ

- การส่งไปยังเครื่องระยะไกลอาจต้องอนุมัติเพิ่มเติม
- การอ่านเนื้อหาไฟล์เป็นส่วนหนึ่งของการส่ง — จะถูกปฏิเสธหากการอ่านไฟล์ถูกปิดโดย permission rules
