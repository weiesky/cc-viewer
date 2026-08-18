# ReadMcpResourceDir

แสดงรายการ entries ของ resource แบบ directory ที่ expose โดย MCP server ที่เชื่อมต่ออยู่ โดยระบุด้วย URI ของมัน

## เมื่อใดควรใช้

- MCP server จัด resource แบบลำดับชั้น และคุณต้องการแจกแจงหนึ่งระดับของลำดับชั้นนั้น
- คุณต้องการสำรวจก่อนอ่าน resource แต่ละรายการด้วย `ReadMcpResource`

## พารามิเตอร์

- `server` (string, required): ชื่อ MCP server
- `uri` (string, required): URI ของ resource แบบ directory ที่จะแสดงรายการ

## ตัวอย่าง

### ตัวอย่างที่ 1: แสดงรายการ resource directory

```
ReadMcpResourceDir(server="filesystem", uri="file:///project/src/")
```

ส่งคืน entries ลูกที่ server expose ภายใต้ directory URI นั้น

## หมายเหตุ

- เฉพาะ server ที่จำลอง resource เป็น directory เท่านั้นที่รองรับ ส่วน server แบบ flat จะส่งคืน error หรือรายการว่าง — ถอยกลับไปใช้ `ListMcpResources`
- ใช้ร่วมกับ `ReadMcpResource` เพื่อเจาะลงไปยัง entries ที่ดูเกี่ยวข้อง
