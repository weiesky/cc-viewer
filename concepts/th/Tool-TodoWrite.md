# TodoWrite

เขียนรายการ todo แบบมีโครงสร้างสำหรับเซสชันปัจจุบัน โดยแทนที่รายการก่อนหน้า แต่ละรายการประกอบด้วยข้อความ, สถานะ, และรูป present-continuous ที่แสดงในตัวบ่งชี้ความคืบหน้า

## เมื่อใดควรใช้

- งานหนึ่งมีหลายขั้นตอนที่แยกจากกัน และการติดตามช่วยให้คุณ (และผู้ใช้) เห็นความคืบหน้า
- ผู้ใช้ขอรายการ todo อย่างชัดเจน
- คุณต้องการทำเครื่องหมายรายการเดียวเท่านั้นว่ากำลังดำเนินการ ในขณะที่รายการที่เหลือคงเป็น pending หรือ completed

## การเปิดใช้งาน

- เครื่องมือรุ่นเก่า: ปิดใช้งานตามค่าเริ่มต้นในเซสชันที่เสนอเครื่องมือ Task (`TaskCreate`, `TaskUpdate`, `TaskList`)
- เปิดใช้งานอีกครั้งด้วย `CLAUDE_CODE_ENABLE_TASKS=0`

## พารามิเตอร์

- `todos` (array, required): รายการ todo ที่อัปเดตแบบสมบูรณ์ แต่ละรายการประกอบด้วย:
  - `content` (string): คำอธิบายงาน
  - `status` (string): หนึ่งใน `pending`, `in_progress`, `completed`
  - `activeForm` (string): ข้อความรูป present-continuous ที่แสดงขณะรายการกำลังดำเนินการ (เช่น "Running tests")

## ตัวอย่าง

### ตัวอย่างที่ 1: ติดตามการเปลี่ยนแปลงสามขั้นตอน

```
TodoWrite(
  todos=[
    {content="Update the parser", status="in_progress", activeForm="Updating the parser"},
    {content="Add unit tests", status="pending", activeForm="Adding unit tests"},
    {content="Run the full test suite", status="pending", activeForm="Running the full test suite"}
  ]
)
```

รายการทั้งหมดถูกเขียนใหม่ทุกครั้งที่เรียก — ใส่ทุกรายการเสมอ ไม่ใช่เฉพาะรายการที่เปลี่ยน

## หมายเหตุ

- รายการถูกแทนที่ทั้งหมดในทุกการเรียก หากต้องการอัปเดตหนึ่งรายการ ให้ส่งทุกรายการใหม่พร้อมสถานะใหม่
- ให้มีรายการเดียวเท่านั้นที่ `in_progress` ในแต่ละครั้ง
- ในเซสชันที่เปิดใช้งาน structured task tools (`TaskCreate`/`TaskUpdate`/`TaskList`) harness อาจเสนอเครื่องมือเหล่านั้นแทน `TodoWrite` — เลือกใช้ชุดเครื่องมือใดก็ได้ที่ advertise
