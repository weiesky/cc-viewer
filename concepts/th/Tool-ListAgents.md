# ListAgents

แสดงรายการ agents ที่คุณ `SendMessage` ถึงได้: subagent ใน process ที่คุณ spawn, เซสชัน Claude ในเครื่องอื่น ๆ บนเครื่องนี้, เซสชันบนคลาวด์ของคุณ (เมื่อเซสชันนี้เข้าถึงคลาวด์ได้), และ — เมื่อเชื่อมต่อ Remote Control — เซสชันอื่น ๆ ของบัญชีของคุณ แต่ละแถวมีป้ายกำกับบอกชนิด

## เมื่อใดควรใช้

- คุณต้องการชื่อที่แน่นอนของ peer session หรือ subagent ก่อนส่งข้อความถึงมัน
- คุณต้องการดูว่าเซสชันใดติดต่อได้จากเซสชันนี้ในขณะนี้

## การเปิดใช้งาน

- ต้องใช้ Claude Code 2.1.224+ และการส่งข้อความข้ามเซสชัน (feature flag ฝั่ง server ปิดตามค่าเริ่มต้น)
- การส่งข้อความข้ามเซสชันไม่พร้อมใช้งานบน Amazon Bedrock, Claude Platform on AWS, Google Cloud Agent Platform, และ Microsoft Foundry
- ปิดเมื่อตั้งค่า `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `DISABLE_TELEMETRY`, `DO_NOT_TRACK`, หรือ `DISABLE_GROWTHBOOK`
- บังคับเปิดใช้งานด้วย `CLAUDE_CODE_HARBOR_KITE=1`

## พารามิเตอร์

- `channel` (string, optional): ไม่มีใน build นี้ ปล่อยไม่ตั้งค่า
- `q` (string, optional): ไม่มีใน build นี้ ปล่อยไม่ตั้งค่า

## ตัวอย่าง

### ตัวอย่างที่ 1: แสดงรายการ agents ที่ติดต่อได้

```
ListAgents()
```

แต่ละแถวพิมพ์ชื่อ — ชื่อนั้นคือที่อยู่ ส่งด้วย `SendMessage({to: "<name>", message: "..."})` โดยคัดลอกชื่อตรงตามที่พิมพ์ ต่อท้าย ` [ref]` ของแถวนั้นเฉพาะเมื่อชื่อล้วนกำกวม (สองแถวใช้ชื่อเดียวกัน หรือ error ขอให้แยกแยะ)

## หมายเหตุ

- อ่านอย่างเดียวและปลอดภัยต่อ concurrency
- เซสชันบนคลาวด์รับข้อความของคุณได้แต่ยังตอบกลับไม่ได้ — อ่านคำตอบได้ใน transcript ของมันเอง
