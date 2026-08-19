# Agent

สร้าง subagent ของ Claude Code แบบอัตโนมัติที่มี context window เป็นของตัวเองเพื่อจัดการงานเฉพาะทางและส่งผลลัพธ์รวมกลับมาเป็นก้อนเดียว นี่คือกลไกมาตรฐานสำหรับการมอบหมายงานวิจัยแบบเปิดกว้าง งานที่ทำขนานกัน หรือการทำงานร่วมกันเป็นทีม

## เมื่อใดควรใช้

- การค้นหาแบบเปิดกว้างที่ยังไม่รู้ว่าไฟล์ใดเกี่ยวข้อง และคาดว่าจะต้องใช้ `Glob`, `Grep`, และ `Read` หลายรอบ
- งานอิสระแบบขนาน — เรียกใช้ agent หลายตัวในข้อความเดียวเพื่อสำรวจพื้นที่ต่างกันพร้อมกัน
- แยกการสำรวจที่ยุ่งเหยิงออกจาก conversation หลัก เพื่อให้ context ของ parent กระชับ
- มอบหมายงานให้ subagent เฉพาะทาง เช่น `Explore`, `Plan`, `claude-code-guide`, หรือ `statusline-setup`
- Spawn teammate ที่มีชื่อเข้าไปในทีมที่กำลังทำงานอยู่สำหรับการทำงานแบบหลาย agent ที่ประสานกัน

อย่าใช้เมื่อรู้ไฟล์หรือ symbol เป้าหมายอยู่แล้ว — ให้ใช้ `Read`, `Grep`, หรือ `Glob` โดยตรง การค้นหาแบบ step เดียวผ่าน `Agent` สิ้นเปลือง context window เต็มหน้าต่างและเพิ่ม latency

## พารามิเตอร์

- `description` (string, required): ป้ายสั้น 3–5 คำอธิบายงาน แสดงใน UI และ log
- `prompt` (string, required): คำสั่งที่สมบูรณ์และเป็นอิสระที่ agent จะรันต้องรวม context ข้อจำกัด และ format ผลลัพธ์ที่คาดหวังทั้งหมด
- `subagent_type` (string, optional): persona สำเร็จรูป เช่น `general-purpose`, `Explore`, `Plan`, `claude-code-guide`, หรือ `statusline-setup` ค่าเริ่มต้นคือ `general-purpose`
- `run_in_background` (boolean, optional): ถ้า true, agent จะรันแบบ asynchronous และ parent สามารถทำงานต่อได้ ผลลัพธ์จะรับกลับในภายหลัง
- `model` (string, optional): เปลี่ยน model สำหรับ agent นี้ — `opus`, `sonnet`, หรือ `haiku` ค่าเริ่มต้นคือ model ของ parent session
- `isolation` (string, optional): ตั้งค่าเป็น `worktree` เพื่อรัน agent ใน git worktree ที่แยกต่างหาก เพื่อไม่ให้การเขียนไฟล์ชนกับ parent
- `team_name` (string, optional): เมื่อ spawn เข้าไปในทีมที่มีอยู่แล้ว นี่คือตัวระบุทีมที่ agent จะเข้าร่วม
- `name` (string, optional): ชื่อ teammate ที่สามารถระบุตำแหน่งได้ภายในทีม ใช้เป็น target `to` สำหรับ `SendMessage`

## ตัวอย่าง

### ตัวอย่างที่ 1: ค้นหาโค้ดแบบเปิดกว้าง

```
Agent(
  description="Find auth middleware",
  subagent_type="Explore",
  prompt="Locate every place in this repo where JWT verification is performed. Return a bulleted list of absolute file paths with a one-line note about each site's role. Do not modify any files."
)
```

### ตัวอย่างที่ 2: การสืบสวนอิสระแบบขนาน

เรียกใช้ agent สองตัวในข้อความเดียวกัน — ตัวหนึ่งตรวจสอบ build pipeline อีกตัวตรวจสอบ test harness แต่ละตัวได้ context window ของตัวเองและส่ง summary กลับ การ batch ใน tool-call block เดียวจะรันพร้อมกัน

### ตัวอย่างที่ 3: Spawn teammate เข้าไปในทีมที่กำลังรันอยู่

```
Agent(
  description="Data layer specialist",
  team_name="refactor-crew",
  name="db-lead",
  prompt="You are db-lead on team refactor-crew. Audit all Prisma schema files and propose a migration plan. Use SendMessage to report findings to the team leader."
)
```

## หมายเหตุ

- Agent ไม่มีความจำของการรันก่อนหน้า ทุกการ invoke เริ่มจากศูนย์ ดังนั้น `prompt` ต้องเป็นอิสระสมบูรณ์ — รวม path ของไฟล์ convention คำถาม และรูปแบบที่แน่นอนของคำตอบที่คุณต้องการกลับมา
- Agent ส่งข้อความสุดท้ายเพียงข้อความเดียว ไม่สามารถถามเพื่อชี้แจงกลางการรันได้ ดังนั้นความคลุมเครือใน prompt จะกลายเป็นการเดาในผลลัพธ์
- การรัน agent หลายตัวพร้อมกันจะเร็วกว่าการเรียกแบบตามลำดับอย่างมีนัยสำคัญเมื่อ subtask เป็นอิสระต่อกัน Batch ทั้งหมดใน tool-call block เดียว
- ใช้ `isolation: "worktree"` เมื่อ agent จะเขียนไฟล์ และคุณต้องการ review การเปลี่ยนแปลงก่อน merge เข้า working tree หลัก
- ชอบ `subagent_type: "Explore"` สำหรับการสอดแนมแบบ read-only และ `Plan` สำหรับงานออกแบบ `general-purpose` เป็นค่าเริ่มต้นสำหรับงานแบบผสม read/write
- Background agent (`run_in_background: true`) เหมาะกับงานที่ใช้เวลานาน หลีกเลี่ยงการ poll ใน sleep loop — parent จะได้รับแจ้งเมื่อเสร็จสิ้น
