# ReadMcpResource

อ่าน resource หนึ่งรายการที่ expose โดย MCP (Model Context Protocol) server ที่เชื่อมต่ออยู่ โดยระบุด้วย URI ของมัน

## เมื่อใดควรใช้

- MCP server advertise resource (ไฟล์, record, เอกสาร) ที่คุณต้องการเนื้อหาใน context
- คุณมี resource URI ที่ชัดเจน — จาก `ListMcpResources`, จาก documentation ของ server, หรือจากผลลัพธ์ของเครื่องมือครั้งก่อน

## การเปิดใช้งาน

- เปิดใช้งานเสมอ แต่ไม่ถูก expose ใน tool list ของโมเดล — มีไว้สำหรับการใช้งานแบบ thin-client / sidecar

## พารามิเตอร์

- `server` (string, required): ชื่อ MCP server
- `uri` (string, required): resource URI ที่จะอ่าน

## ตัวอย่าง

### ตัวอย่างที่ 1: อ่าน resource ของ server ด้วย URI

```
ReadMcpResource(server="github", uri="file:///repo/docs/architecture.md")
```

ส่งคืนเนื้อหา resource ตามที่ MCP server `github` ให้มา

## หมายเหตุ

- ใช้ `ListMcpResources` ก่อนหากไม่รู้ว่า server expose resource อะไรบ้าง ใช้ `ReadMcpResourceDir` สำหรับการแสดงรายการแบบ directory
- รูปแบบ URI เป็นของแต่ละ server (`file://`, `https://`, รูปแบบกำหนดเอง) — ตรวจสอบว่า server เป้าหมาย advertise อะไร
