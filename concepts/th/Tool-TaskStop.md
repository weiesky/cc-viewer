# TaskStop

## คำจำกัดความ

หยุดงานเบื้องหลังที่กำลังทำงานอยู่

## พารามิเตอร์

| พารามิเตอร์ | ประเภท | จำเป็น | คำอธิบาย |
|------|------|------|------|
| `task_id` | string | ไม่ | ID ของงานเบื้องหลังที่จะหยุด |
| `shell_id` | string | ไม่ | เลิกใช้แล้ว ใช้ `task_id` แทน |

## สถานการณ์การใช้งาน

**เหมาะสำหรับ:**
- ยุติงานที่ทำงานนานที่ไม่ต้องการอีกต่อไป
- ยกเลิกงานเบื้องหลังที่เริ่มผิดพลาด

## ข้อควรระวัง

- ส่งคืนสถานะสำเร็จหรือล้มเหลว
- พารามิเตอร์ `shell_id` เลิกใช้แล้ว ควรใช้ `task_id`

## ความสำคัญใน cc-viewer

การเรียก TaskStop ไม่สร้างคำร้องขอ API เป็นการดำเนินการจัดการงานภายในของ Claude Code

## ข้อความต้นฉบับ

<textarea readonly>
- Stops a running background task by its ID
- Takes a task_id parameter identifying the task to stop
- Returns a success or failure status
- Use this tool when you need to terminate a long-running task
</textarea>
