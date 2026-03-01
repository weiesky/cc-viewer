# Skill

## คำจำกัดความ

รันทักษะ (skill) ในการสนทนาหลัก ทักษะคือความสามารถเฉพาะทางที่ผู้ใช้สามารถเรียกใช้ผ่าน slash command (เช่น `/commit`, `/review-pr`)

## พารามิเตอร์

| พารามิเตอร์ | ประเภท | จำเป็น | คำอธิบาย |
|------|------|------|------|
| `skill` | string | ใช่ | ชื่อทักษะ (เช่น "commit", "review-pr", "pdf") |
| `args` | string | ไม่ | อาร์กิวเมนต์ของทักษะ |

## สถานการณ์การใช้งาน

**เหมาะสำหรับ:**
- ผู้ใช้ป้อน slash command ในรูปแบบ `/<skill-name>`
- คำร้องขอของผู้ใช้ตรงกับฟังก์ชันของทักษะที่ลงทะเบียนไว้

**ไม่เหมาะสำหรับ:**
- คำสั่ง CLI ในตัว (เช่น `/help`, `/clear`)
- ทักษะที่กำลังทำงานอยู่แล้ว
- ชื่อทักษะที่ไม่อยู่ในรายการทักษะที่ใช้ได้

## ข้อควรระวัง

- หลังจากถูกเรียก ทักษะจะขยายเป็น prompt ที่สมบูรณ์
- รองรับชื่อแบบเต็ม (เช่น `ms-office-suite:pdf`)
- รายการทักษะที่ใช้ได้จะอยู่ในข้อความ system-reminder
- เมื่อเห็นแท็ก `<command-name>` แสดงว่าทักษะถูกโหลดแล้ว ควรดำเนินการโดยตรงโดยไม่ต้องเรียกเครื่องมือนี้อีก
- อย่ากล่าวถึงทักษะโดยไม่ได้เรียกเครื่องมือจริง

## ความสำคัญใน cc-viewer

การเรียก Skill ปรากฏในบันทึกคำร้องขอเป็น content block `tool_use` prompt ที่ขยายจากทักษะจะส่งผลต่อ system prompt หรือเนื้อหาข้อความของคำร้องขอถัดไป

## ข้อความต้นฉบับ

<textarea readonly>Execute a skill within the main conversation

When users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.

When users reference a "slash command" or "/<something>" (e.g., "/commit", "/review-pr"), they are referring to a skill. Use this tool to invoke it.

How to invoke:
- Use this tool with the skill name and optional arguments
- Examples:
  - `skill: "pdf"` - invoke the pdf skill
  - `skill: "commit", args: "-m 'Fix bug'"` - invoke with arguments
  - `skill: "review-pr", args: "123"` - invoke with arguments
  - `skill: "ms-office-suite:pdf"` - invoke using fully qualified name

Important:
- Available skills are listed in system-reminder messages in the conversation
- When a skill matches the user's request, this is a BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response about the task
- NEVER mention a skill without actually calling this tool
- Do not invoke a skill that is already running
- Do not use this tool for built-in CLI commands (like /help, /clear, etc.)
- If you see a <command-name> tag in the current conversation turn, the skill has ALREADY been loaded - follow the instructions directly instead of calling this tool again
</textarea>
