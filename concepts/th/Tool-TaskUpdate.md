# TaskUpdate

## คำจำกัดความ

อัปเดตสถานะ เนื้อหา หรือความสัมพันธ์การพึ่งพาของงานในรายการงาน

## พารามิเตอร์

| พารามิเตอร์ | ประเภท | จำเป็น | คำอธิบาย |
|------|------|------|------|
| `taskId` | string | ใช่ | ID ของงานที่จะอัปเดต |
| `status` | enum | ไม่ | สถานะใหม่: `pending` / `in_progress` / `completed` / `deleted` |
| `subject` | string | ไม่ | หัวข้อใหม่ |
| `description` | string | ไม่ | คำอธิบายใหม่ |
| `activeForm` | string | ไม่ | ข้อความรูปแบบกำลังดำเนินการที่แสดงเมื่อกำลังทำงาน |
| `owner` | string | ไม่ | ผู้รับผิดชอบงานใหม่ (ชื่อ agent) |
| `metadata` | object | ไม่ | ข้อมูลเมตาที่จะรวม (ตั้งเป็น null เพื่อลบคีย์) |
| `addBlocks` | string[] | ไม่ | รายการ ID ของงานที่ถูกบล็อกโดยงานนี้ |
| `addBlockedBy` | string[] | ไม่ | รายการ ID ของงานเงื่อนไขก่อนหน้าที่บล็อกงานนี้ |

## การเปลี่ยนสถานะ

```
pending → in_progress → completed
```

`deleted` สามารถเปลี่ยนจากสถานะใดก็ได้ ลบงานอย่างถาวร

## สถานการณ์การใช้งาน

**เหมาะสำหรับ:**
- ทำเครื่องหมายงานเป็น `in_progress` เมื่อเริ่มทำงาน
- ทำเครื่องหมายงานเป็น `completed` หลังจากทำงานเสร็จ
- ตั้งค่าความสัมพันธ์การพึ่งพาระหว่างงาน
- อัปเดตเนื้อหางานเมื่อข้อกำหนดเปลี่ยนแปลง

**กฎสำคัญ:**
- ทำเครื่องหมายเป็น `completed` เฉพาะเมื่อทำงานเสร็จสมบูรณ์เท่านั้น
- คงสถานะ `in_progress` เมื่อพบข้อผิดพลาดหรือการบล็อก
- ห้ามทำเครื่องหมายเป็น `completed` เมื่อการทดสอบล้มเหลว การดำเนินงานไม่สมบูรณ์ หรือมีข้อผิดพลาดที่ยังไม่ได้แก้ไข

## ข้อควรระวัง

- ก่อนอัปเดต ควรรับสถานะล่าสุดของงานผ่าน TaskGet เพื่อหลีกเลี่ยงข้อมูลที่ล้าสมัย
- หลังจากทำงานเสร็จ เรียก TaskList เพื่อค้นหางานถัดไปที่พร้อมทำ

## ความสำคัญใน cc-viewer

TaskUpdate เป็นการดำเนินการจัดการงานภายใน ไม่สร้างคำร้องขอ API อิสระ

## ข้อความต้นฉบับ

<textarea readonly>Use this tool to update a task in the task list.

## When to Use This Tool

**Mark tasks as resolved:**
- When you have completed the work described in a task
- When a task is no longer needed or has been superseded
- IMPORTANT: Always mark your assigned tasks as resolved when you finish them
- After resolving, call TaskList to find your next task

- ONLY mark a task as completed when you have FULLY accomplished it
- If you encounter errors, blockers, or cannot finish, keep the task as in_progress
- When blocked, create a new task describing what needs to be resolved
- Never mark a task as completed if:
  - Tests are failing
  - Implementation is partial
  - You encountered unresolved errors
  - You couldn't find necessary files or dependencies

**Delete tasks:**
- When a task is no longer relevant or was created in error
- Setting status to `deleted` permanently removes the task

**Update task details:**
- When requirements change or become clearer
- When establishing dependencies between tasks

## Fields You Can Update

- **status**: The task status (see Status Workflow below)
- **subject**: Change the task title (imperative form, e.g., "Run tests")
- **description**: Change the task description
- **activeForm**: Present continuous form shown in spinner when in_progress (e.g., "Running tests")
- **owner**: Change the task owner (agent name)
- **metadata**: Merge metadata keys into the task (set a key to null to delete it)
- **addBlocks**: Mark tasks that cannot start until this one completes
- **addBlockedBy**: Mark tasks that must complete before this one can start

## Status Workflow

Status progresses: `pending` → `in_progress` → `completed`

Use `deleted` to permanently remove a task.

## Staleness

Make sure to read a task's latest state using `TaskGet` before updating it.

## Examples

Mark task as in progress when starting work:
```json
{"taskId": "1", "status": "in_progress"}
```

Mark task as completed after finishing work:
```json
{"taskId": "1", "status": "completed"}
```

Delete a task:
```json
{"taskId": "1", "status": "deleted"}
```

Claim a task by setting owner:
```json
{"taskId": "1", "owner": "my-name"}
```

Set up task dependencies:
```json
{"taskId": "2", "addBlockedBy": ["1"]}
```
</textarea>
