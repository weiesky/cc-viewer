# TaskOutput

## คำจำกัดความ

รับผลลัพธ์ของงานเบื้องหลังที่กำลังทำงานหรือเสร็จสิ้นแล้ว ใช้ได้กับ shell เบื้องหลัง agent แบบอะซิงโครนัส และเซสชันระยะไกล

## พารามิเตอร์

| พารามิเตอร์ | ประเภท | จำเป็น | คำอธิบาย |
|------|------|------|------|
| `task_id` | string | ใช่ | ID ของงาน |
| `block` | boolean | ใช่ | บล็อกรอจนกว่างานจะเสร็จหรือไม่ ค่าเริ่มต้น `true` |
| `timeout` | number | ใช่ | เวลารอสูงสุด (มิลลิวินาที) ค่าเริ่มต้น 30000 สูงสุด 600000 |

## สถานการณ์การใช้งาน

**เหมาะสำหรับ:**
- ตรวจสอบความคืบหน้าของ agent เบื้องหลังที่เริ่มผ่าน Task (`run_in_background: true`)
- รับผลลัพธ์การรันคำสั่ง Bash เบื้องหลัง
- รอให้งานอะซิงโครนัสเสร็จสิ้นและรับผลลัพธ์

**ไม่เหมาะสำหรับ:**
- งานเบื้องหน้า — งานเบื้องหน้าส่งคืนผลลัพธ์โดยตรง ไม่ต้องใช้เครื่องมือนี้

## ข้อควรระวัง

- `block: true` จะบล็อกจนกว่างานจะเสร็จหรือหมดเวลา
- `block: false` ใช้สำหรับตรวจสอบสถานะปัจจุบันแบบไม่บล็อก
- ID ของงานสามารถค้นหาได้ผ่านคำสั่ง `/tasks`
- ใช้ได้กับงานทุกประเภท: shell เบื้องหลัง, agent แบบอะซิงโครนัส, เซสชันระยะไกล

## ความสำคัญใน cc-viewer

การเรียก TaskOutput ไม่สร้างคำร้องขอ API เป็นการดำเนินการจัดการงานภายในของ Claude Code และไม่ปรากฏในบันทึกคำร้องขอ

## ข้อความต้นฉบับ

<textarea readonly>- Retrieves output from a running or completed task (background shell, agent, or remote session)
- Takes a task_id parameter identifying the task
- Returns the task output along with status information
- Use block=true (default) to wait for task completion
- Use block=false for non-blocking check of current status
- Task IDs can be found using the /tasks command
- Works with all task types: background shells, async agents, and remote sessions</textarea>
