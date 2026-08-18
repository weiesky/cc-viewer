# ListMcpResources

แสดงรายการ resource ที่ expose โดย MCP server ที่เชื่อมต่ออยู่ กรองเหลือ server เดียวได้ (ไม่บังคับ)

## เมื่อใดควรใช้

- คุณต้องค้นพบว่า MCP server นำเสนอ resource (ไฟล์, record, เอกสาร) อะไรบ้างก่อนอ่าน
- คุณต้องการภาพรวมของ resource ทั้งหมดจากทุก server ที่เชื่อมต่อ

## พารามิเตอร์

- `server` (string, optional): ชื่อ server ที่ใช้กรอง resource ละเว้นเพื่อแสดงรายการ resource จากทุก server ที่เชื่อมต่อ

## ตัวอย่าง

### ตัวอย่างที่ 1: แสดงรายการทั้งหมด

```
ListMcpResources()
```

### ตัวอย่างที่ 2: แสดงรายการ resource ของ server หนึ่ง

```
ListMcpResources(server="github")
```

## หมายเหตุ

- นี่คือขั้นตอนค้นพบ: ป้อน URI ที่น่าสนใจเข้า `ReadMcpResource` (resource เดียว) หรือ `ReadMcpResourceDir` (รายการแบบ directory)
- server เชื่อมต่อและตัดการเชื่อมต่อตลอดอายุเซสชัน — แสดงรายการใหม่หากเพิ่งเพิ่ม server
