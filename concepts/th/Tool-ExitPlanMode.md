# ExitPlanMode

## คำจำกัดความ

ออกจากโหมดวางแผนและส่งแผนให้ผู้ใช้อนุมัติ เนื้อหาแผนจะถูกอ่านจากไฟล์แผนที่เขียนไว้ก่อนหน้า

## พารามิเตอร์

| พารามิเตอร์ | ประเภท | จำเป็น | คำอธิบาย |
|------|------|------|------|
| `allowedPrompts` | array | ไม่ | รายการคำอธิบายสิทธิ์ที่จำเป็นสำหรับแผนการดำเนินงาน |

แต่ละองค์ประกอบในอาร์เรย์ `allowedPrompts`:

| ฟิลด์ | ประเภท | จำเป็น | คำอธิบาย |
|------|------|------|------|
| `tool` | enum | ใช่ | เครื่องมือที่ใช้ได้ ปัจจุบันรองรับเฉพาะ `Bash` |
| `prompt` | string | ใช่ | คำอธิบายเชิงความหมายของการดำเนินงาน (เช่น "run tests", "install dependencies") |

## สถานการณ์การใช้งาน

**เหมาะสำหรับ:**
- ในโหมดวางแผน เมื่อแผนเสร็จสมบูรณ์และพร้อมส่งให้ผู้ใช้อนุมัติ
- ใช้เฉพาะสำหรับงานดำเนินการที่ต้องเขียนโค้ด

**ไม่เหมาะสำหรับ:**
- งานวิจัย/สำรวจล้วนๆ — ไม่จำเป็นต้องออกจากโหมดวางแผน
- ต้องการถามผู้ใช้ว่า "แผนนี้โอเคไหม?" — นี่คือฟังก์ชันของเครื่องมือนี้เอง อย่าใช้ AskUserQuestion เพื่อถาม

## ข้อควรระวัง

- เครื่องมือนี้ไม่รับเนื้อหาแผนเป็นพารามิเตอร์ — มันอ่านจากไฟล์แผนที่เขียนไว้ก่อนหน้า
- ผู้ใช้จะเห็นเนื้อหาของไฟล์แผนเพื่ออนุมัติ
- อย่าใช้ AskUserQuestion ถามว่า "แผนโอเคไหม?" ก่อนเรียกเครื่องมือนี้ เพราะเป็นการซ้ำซ้อน
- อย่ากล่าวถึง "แผน" ในคำถาม เพราะผู้ใช้ไม่สามารถเห็นเนื้อหาแผนก่อน ExitPlanMode

## ความสำคัญใน cc-viewer

การเรียก ExitPlanMode เป็นเครื่องหมายสิ้นสุดขั้นตอนการวางแผน ในบันทึกคำร้องขอ คำร้องขอหลังจากการเรียกนี้มักจะเปลี่ยนเป็นการดำเนินงานเชิงปฏิบัติ (Edit, Write, Bash ฯลฯ)

## ข้อความต้นฉบับ

<textarea readonly>Use this tool when you are in plan mode and have finished writing your plan to the plan file and are ready for user approval.

## How This Tool Works
- You should have already written your plan to the plan file specified in the plan mode system message
- This tool does NOT take the plan content as a parameter - it will read the plan from the file you wrote
- This tool simply signals that you're done planning and ready for the user to review and approve
- The user will see the contents of your plan file when they review it

## When to Use This Tool
IMPORTANT: Only use this tool when the task requires planning the implementation steps of a task that requires writing code. For research tasks where you're gathering information, searching files, reading files or in general trying to understand the codebase - do NOT use this tool.

## Before Using This Tool
Ensure your plan is complete and unambiguous:
- If you have unresolved questions about requirements or approach, use AskUserQuestion first (in earlier phases)
- Once your plan is finalized, use THIS tool to request approval

**Important:** Do NOT use AskUserQuestion to ask "Is this plan okay?" or "Should I proceed?" - that's exactly what THIS tool does. ExitPlanMode inherently requests user approval of your plan.

## Examples

1. Initial task: "Search for and understand the implementation of vim mode in the codebase" - Do not use the exit plan mode tool because you are not planning the implementation steps of a task.
2. Initial task: "Help me implement yank mode for vim" - Use the exit plan mode tool after you have finished planning the implementation steps of the task.
3. Initial task: "Add a new feature to handle user authentication" - If unsure about auth method (OAuth, JWT, etc.), use AskUserQuestion first, then use exit plan mode tool after clarifying the approach.
</textarea>
