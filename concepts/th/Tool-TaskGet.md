# TaskGet

## คำจำกัดความ

รับรายละเอียดงานทั้งหมดผ่าน ID ของงาน

## พารามิเตอร์

| พารามิเตอร์ | ประเภท | จำเป็น | คำอธิบาย |
|------|------|------|------|
| `taskId` | string | ใช่ | ID ของงานที่จะรับข้อมูล |

## เนื้อหาที่ส่งคืน

- `subject` — หัวข้องาน
- `description` — ข้อกำหนดโดยละเอียดและบริบท
- `status` — สถานะ: `pending`, `in_progress` หรือ `completed`
- `blocks` — รายการงานที่ถูกบล็อกโดยงานนี้
- `blockedBy` — รายการงานเงื่อนไขก่อนหน้าที่บล็อกงานนี้

## สถานการณ์การใช้งาน

**เหมาะสำหรับ:**
- รับคำอธิบายและบริบทที่สมบูรณ์ของงานก่อนเริ่มทำงาน
- ทำความเข้าใจความสัมพันธ์การพึ่งพาของงาน
- รับข้อกำหนดที่สมบูรณ์หลังจากได้รับมอบหมายงาน

## ข้อควรระวัง

- หลังจากรับงาน ควรตรวจสอบว่ารายการ `blockedBy` ว่างเปล่าก่อนเริ่มทำงาน
- ใช้ TaskList เพื่อดูข้อมูลสรุปของงานทั้งหมด

## ความสำคัญใน cc-viewer

TaskGet เป็นการดำเนินการจัดการงานภายใน ไม่สร้างคำร้องขอ API อิสระ

## ข้อความต้นฉบับ

<textarea readonly>Use this tool to retrieve a task by its ID from the task list.

## When to Use This Tool

- When you need the full description and context before starting work on a task
- To understand task dependencies (what it blocks, what blocks it)
- After being assigned a task, to get complete requirements

## Output

Returns full task details:
- **subject**: Task title
- **description**: Detailed requirements and context
- **status**: 'pending', 'in_progress', or 'completed'
- **blocks**: Tasks waiting on this one to complete
- **blockedBy**: Tasks that must complete before this one can start

## Tips

- After fetching a task, verify its blockedBy list is empty before beginning work.
- Use TaskList to see all tasks in summary form.
</textarea>
