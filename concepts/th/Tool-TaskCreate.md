# TaskCreate

## คำจำกัดความ

สร้างรายการในรายการงานแบบมีโครงสร้าง ใช้สำหรับติดตามความคืบหน้า จัดระเบียบงานที่ซับซ้อน และแสดงความคืบหน้าของงานให้ผู้ใช้เห็น

## พารามิเตอร์

| พารามิเตอร์ | ประเภท | จำเป็น | คำอธิบาย |
|------|------|------|------|
| `subject` | string | ใช่ | หัวข้องานสั้น ใช้รูปแบบคำสั่ง (เช่น "Fix authentication bug") |
| `description` | string | ใช่ | คำอธิบายโดยละเอียด รวมถึงบริบทและเกณฑ์การยอมรับ |
| `activeForm` | string | ไม่ | ข้อความรูปแบบกำลังดำเนินการที่แสดงเมื่อกำลังทำงาน (เช่น "Fixing authentication bug") |
| `metadata` | object | ไม่ | ข้อมูลเมตาที่แนบกับงาน |

## สถานการณ์การใช้งาน

**เหมาะสำหรับ:**
- งานหลายขั้นตอนที่ซับซ้อน (มากกว่า 3 ขั้นตอน)
- ผู้ใช้ให้รายการสิ่งที่ต้องทำหลายรายการ
- ติดตามงานในโหมดวางแผน
- ผู้ใช้ร้องขออย่างชัดเจนให้ใช้รายการ todo

**ไม่เหมาะสำหรับ:**
- งานเดียวที่ง่าย
- การดำเนินการง่ายๆ ไม่เกิน 3 ขั้นตอน
- การสนทนาหรือการสอบถามข้อมูลล้วนๆ

## ข้อควรระวัง

- งานที่สร้างใหม่ทั้งหมดมีสถานะเริ่มต้นเป็น `pending`
- `subject` ใช้รูปแบบคำสั่ง ("Run tests"), `activeForm` ใช้รูปแบบกำลังดำเนินการ ("Running tests")
- หลังจากสร้างงาน สามารถตั้งค่าความสัมพันธ์การพึ่งพา (blocks/blockedBy) ผ่าน TaskUpdate
- ก่อนสร้าง ควรเรียก TaskList เพื่อตรวจสอบว่ามีงานซ้ำหรือไม่

## ความสำคัญใน cc-viewer

TaskCreate เป็นการดำเนินการจัดการงานภายในของ Claude Code ไม่สร้างคำร้องขอ API อิสระ แต่ใน Chat Mode สามารถเห็น tool_use block ที่โมเดลเรียกเครื่องมือนี้ได้

## ข้อความต้นฉบับ

<textarea readonly>Use this tool to create a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

## When to Use This Tool

Use this tool proactively in these scenarios:

- Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
- Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
- Plan mode - When using plan mode, create a task list to track the work
- User explicitly requests todo list - When the user directly asks you to use the todo list
- User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
- After receiving new instructions - Immediately capture user requirements as tasks
- When you start working on a task - Mark it as in_progress BEFORE beginning work
- After completing a task - Mark it as completed and add any new follow-up tasks discovered during implementation

## When NOT to Use This Tool

Skip using this tool when:
- There is only a single, straightforward task
- The task is trivial and tracking it provides no organizational benefit
- The task can be completed in less than 3 trivial steps
- The task is purely conversational or informational

NOTE that you should not use this tool if there is only one trivial task to do. In this case you are better off just doing the task directly.

## Task Fields

- **subject**: A brief, actionable title in imperative form (e.g., "Fix authentication bug in login flow")
- **description**: Detailed description of what needs to be done, including context and acceptance criteria
- **activeForm**: Present continuous form shown in spinner when task is in_progress (e.g., "Fixing authentication bug"). This is displayed to the user while you work on the task.

**IMPORTANT**: Always provide activeForm when creating tasks. The subject should be imperative ("Run tests") while activeForm should be present continuous ("Running tests"). All tasks are created with status `pending`.

## Tips

- Create tasks with clear, specific subjects that describe the outcome
- Include enough detail in the description for another agent to understand and complete the task
- After creating tasks, use TaskUpdate to set up dependencies (blocks/blockedBy) if needed
- Check TaskList first to avoid creating duplicate tasks
</textarea>
