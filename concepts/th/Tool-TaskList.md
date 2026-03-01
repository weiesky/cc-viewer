# TaskList

## คำจำกัดความ

แสดงรายการงานทั้งหมดในรายการงาน เพื่อดูความคืบหน้าโดยรวมและงานที่พร้อมทำ

## พารามิเตอร์

ไม่มีพารามิเตอร์

## เนื้อหาที่ส่งคืน

ข้อมูลสรุปของแต่ละงาน:
- `id` — ตัวระบุงาน
- `subject` — คำอธิบายสั้น
- `status` — สถานะ: `pending`, `in_progress` หรือ `completed`
- `owner` — ผู้รับผิดชอบ (ID ของ agent) ว่างหมายถึงยังไม่ได้มอบหมาย
- `blockedBy` — รายการ ID ของงานที่ยังไม่เสร็จที่บล็อกงานนี้

## สถานการณ์การใช้งาน

**เหมาะสำหรับ:**
- ดูว่ามีงานใดพร้อมทำ (สถานะ pending ไม่มี owner ไม่ถูกบล็อก)
- ตรวจสอบความคืบหน้าโดยรวมของโปรเจกต์
- ค้นหางานที่ถูกบล็อก
- ค้นหางานถัดไปหลังจากทำงานเสร็จ

## ข้อควรระวัง

- ควรดำเนินการงานตามลำดับ ID (ID น้อยสุดก่อน) เพราะงานก่อนหน้ามักให้บริบทสำหรับงานถัดไป
- งานที่มี `blockedBy` ไม่สามารถรับมาทำได้จนกว่าการพึ่งพาจะถูกแก้ไข
- ใช้ TaskGet เพื่อรับรายละเอียดที่สมบูรณ์ของงานเฉพาะ

## ความสำคัญใน cc-viewer

TaskList เป็นการดำเนินการจัดการงานภายใน ไม่สร้างคำร้องขอ API อิสระ

## ข้อความต้นฉบับ

<textarea readonly>Use this tool to list all tasks in the task list.

## When to Use This Tool

- To see what tasks are available to work on (status: 'pending', no owner, not blocked)
- To check overall progress on the project
- To find tasks that are blocked and need dependencies resolved
- After completing a task, to check for newly unblocked work or claim the next available task
- **Prefer working on tasks in ID order** (lowest ID first) when multiple tasks are available, as earlier tasks often set up context for later ones

## Output

Returns a summary of each task:
- **id**: Task identifier (use with TaskGet, TaskUpdate)
- **subject**: Brief description of the task
- **status**: 'pending', 'in_progress', or 'completed'
- **owner**: Agent ID if assigned, empty if available
- **blockedBy**: List of open task IDs that must be resolved first (tasks with blockedBy cannot be claimed until dependencies resolve)

Use TaskGet with a specific task ID to view full details including description and comments.
</textarea>
