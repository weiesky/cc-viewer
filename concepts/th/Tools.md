# ภาพรวมเครื่องมือของ Claude Code

Claude Code มอบชุดเครื่องมือในตัวให้กับโมเดลผ่านกลไก tool_use ของ Anthropic API อาร์เรย์ `tools` ของคำร้องขอ MainAgent แต่ละรายการจะมีคำจำกัดความ JSON Schema ที่สมบูรณ์ของเครื่องมือเหล่านี้ และโมเดลจะเรียกใช้ผ่าน content block `tool_use` ในการตอบกลับ

ต่อไปนี้คือดัชนีจำแนกตามหมวดหมู่ของเครื่องมือทั้งหมด

## ระบบ Agent

| เครื่องมือ | วัตถุประสงค์ |
|------|------|
| [Task](Tool-Task.md) | เริ่มต้น sub-agent (SubAgent) เพื่อจัดการงานหลายขั้นตอนที่ซับซ้อน |
| [TaskOutput](Tool-TaskOutput.md) | รับผลลัพธ์ของงานเบื้องหลัง |
| [TaskStop](Tool-TaskStop.md) | หยุดงานเบื้องหลังที่กำลังทำงาน |
| [TaskCreate](Tool-TaskCreate.md) | สร้างรายการในรายการงานแบบมีโครงสร้าง |
| [TaskGet](Tool-TaskGet.md) | รับรายละเอียดงาน |
| [TaskUpdate](Tool-TaskUpdate.md) | อัปเดตสถานะงาน ความสัมพันธ์การพึ่งพา ฯลฯ |
| [TaskList](Tool-TaskList.md) | แสดงรายการงานทั้งหมด |

## การดำเนินการไฟล์

| เครื่องมือ | วัตถุประสงค์ |
|------|------|
| [Read](Tool-Read.md) | อ่านเนื้อหาไฟล์ (รองรับข้อความ, รูปภาพ, PDF, Jupyter notebook) |
| [Edit](Tool-Edit.md) | แก้ไขไฟล์ด้วยการแทนที่สตริงที่แม่นยำ |
| [Write](Tool-Write.md) | เขียนหรือเขียนทับไฟล์ |
| [NotebookEdit](Tool-NotebookEdit.md) | แก้ไขเซลล์ Jupyter notebook |

## การค้นหา

| เครื่องมือ | วัตถุประสงค์ |
|------|------|
| [Glob](Tool-Glob.md) | ค้นหาไฟล์ตามรูปแบบชื่อไฟล์ |
| [Grep](Tool-Grep.md) | ค้นหาเนื้อหาไฟล์โดยใช้ ripgrep |

## เทอร์มินัล

| เครื่องมือ | วัตถุประสงค์ |
|------|------|
| [Bash](Tool-Bash.md) | รันคำสั่ง shell |

## เว็บ

| เครื่องมือ | วัตถุประสงค์ |
|------|------|
| [WebFetch](Tool-WebFetch.md) | ดึงเนื้อหาเว็บเพจและประมวลผลด้วย AI |
| [WebSearch](Tool-WebSearch.md) | ค้นหาผ่านเครื่องมือค้นหา |

## การวางแผนและการโต้ตอบ

| เครื่องมือ | วัตถุประสงค์ |
|------|------|
| [EnterPlanMode](Tool-EnterPlanMode.md) | เข้าสู่โหมดวางแผนเพื่อออกแบบแผนการดำเนินงาน |
| [ExitPlanMode](Tool-ExitPlanMode.md) | ออกจากโหมดวางแผนและส่งแผนให้ผู้ใช้อนุมัติ |
| [AskUserQuestion](Tool-AskUserQuestion.md) | ถามคำถามผู้ใช้เพื่อขอคำชี้แจงหรือการตัดสินใจ |

## ส่วนขยาย

| เครื่องมือ | วัตถุประสงค์ |
|------|------|
| [Skill](Tool-Skill.md) | รันทักษะ (slash command) |

## การรวมกับ IDE

| เครื่องมือ | วัตถุประสงค์ |
|------|------|
| [getDiagnostics](Tool-getDiagnostics.md) | รับข้อมูลการวินิจฉัยภาษาจาก VS Code |
| [executeCode](Tool-executeCode.md) | รันโค้ดใน Jupyter kernel |
