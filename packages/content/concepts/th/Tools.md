# ภาพรวมเครื่องมือของ Claude Code

Claude Code มอบชุดเครื่องมือในตัวให้กับโมเดลผ่านกลไก tool_use ของ Anthropic API อาร์เรย์ `tools` ของคำร้องขอ MainAgent แต่ละรายการจะมีคำจำกัดความ JSON Schema ที่สมบูรณ์ของเครื่องมือเหล่านี้ และโมเดลจะเรียกใช้ผ่าน content block `tool_use` ในการตอบกลับ

ต่อไปนี้คือดัชนีจำแนกตามหมวดหมู่ของเครื่องมือทั้งหมด

## ระบบ Agent

| เครื่องมือ | วัตถุประสงค์ |
|------|------|
| [Agent](Tool-Agent.md) | เริ่มต้น sub-agent (SubAgent) เพื่อจัดการงานหลายขั้นตอนที่ซับซ้อน |
| [TaskOutput](Tool-TaskOutput.md) | รับผลลัพธ์ของงานเบื้องหลัง |
| [TaskStop](Tool-TaskStop.md) | หยุดงานเบื้องหลังที่กำลังทำงาน |
| [TaskCreate](Tool-TaskCreate.md) | สร้างรายการในรายการงานแบบมีโครงสร้าง |
| [TaskGet](Tool-TaskGet.md) | รับรายละเอียดงาน |
| [TaskUpdate](Tool-TaskUpdate.md) | อัปเดตสถานะงาน ความสัมพันธ์การพึ่งพา ฯลฯ |
| [TaskList](Tool-TaskList.md) | แสดงรายการงานทั้งหมด |
| [ListAgents](Tool-ListAgents.md) | แสดงรายการ agents ที่มีในเซสชัน |

## ทีมและการประสานงาน

| เครื่องมือ | วัตถุประสงค์ |
|------|------|
| [SendMessage](Tool-SendMessage.md) | ส่งข้อความไปยัง agent อื่น |
| [Workflow](Tool-Workflow.md) | รันสคริปต์การประสานงาน multi-agent ที่กำหนด |
| [Monitor](Tool-Monitor.md) | สตรีมเหตุการณ์จากสคริปต์ที่ทำงานยาวนานเป็นการแจ้งเตือน |
| [SendFile](Tool-SendFile.md) | ส่งไฟล์ไปยังเซสชันของ Claude Code อื่น |
| [SendUserFile](Tool-SendUserFile.md) | ส่งไฟล์ให้ผู้ใช้ |
| [SendUserMessage](Tool-SendUserMessage.md) | ส่งข้อความถึงผู้ใช้ (เครื่องมือ Brief รุ่นเดิม) |
| [EndConversation](Tool-EndConversation.md) | จบ conversation ปัจจุบัน |

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
| [ToolSearch](Tool-ToolSearch.md) | ค้นหาและโหลดเครื่องมือ deferred/MCP ตามต้องการ |

## เทอร์มินัล

| เครื่องมือ | วัตถุประสงค์ |
|------|------|
| [Bash](Tool-Bash.md) | รันคำสั่ง shell |
| [REPL](Tool-REPL.md) | รัน JavaScript ใน Node.js REPL แบบ persistent |

## เว็บ

| เครื่องมือ | วัตถุประสงค์ |
|------|------|
| [WebFetch](Tool-WebFetch.md) | ดึงเนื้อหาเว็บเพจและประมวลผลด้วย AI |
| [WebSearch](Tool-WebSearch.md) | ค้นหาผ่านเครื่องมือค้นหา |
| [Artifact](Tool-Artifact.md) | เผยแพร่ไฟล์ HTML/Markdown เป็นหน้าเว็บที่โฮสต์บน claude.ai |
| [DesignSync](Tool-DesignSync.md) | ซิงค์ไลบรารีส่วนประกอบในเครื่องกับโปรเจ็กต์ design-system บน claude.ai |

## การวางแผนและการโต้ตอบ

| เครื่องมือ | วัตถุประสงค์ |
|------|------|
| [EnterPlanMode](Tool-EnterPlanMode.md) | เข้าสู่โหมดวางแผนเพื่อออกแบบแผนการดำเนินงาน |
| [ExitPlanMode](Tool-ExitPlanMode.md) | ออกจากโหมดวางแผนและส่งแผนให้ผู้ใช้อนุมัติ |
| [AskUserQuestion](Tool-AskUserQuestion.md) | ถามคำถามผู้ใช้เพื่อขอคำชี้แจงหรือการตัดสินใจ |
| [ReportFindings](Tool-ReportFindings.md) | รายงานสิ่งที่ค้นพบจากการ code-review เป็นรายการที่พิมพ์สำหรับ UI |
| [TodoWrite](Tool-TodoWrite.md) | เขียนรายการ todo แบบมีโครงสร้างสำหรับเซสชัน |
| [SendFeedback](Tool-SendFeedback.md) | ส่ง feedback แบบมีโครงสร้างเกี่ยวกับ Claude Code ไปยัง Anthropic |
| [Projects](Tool-Projects.md) | จัดการเอกสารฐานความรู้ของโปรเจกต์ |
| [ProposeGoal](Tool-ProposeGoal.md) | เสนอเป้าหมายความสำเร็จที่ตรวจสอบได้สำหรับเซสชัน |

## Worktrees

| เครื่องมือ | วัตถุประสงค์ |
|------|------|
| [EnterWorktree](Tool-EnterWorktree.md) | สร้างหรือเข้าสู่ worktree git ที่แยกส่วนสำหรับเซสชัน |
| [ExitWorktree](Tool-ExitWorktree.md) | ออกจาก worktree, คง หรือลบ |

## ตั้งเวลาและการแจ้งเตือน

| เครื่องมือ | วัตถุประสงค์ |
|------|------|
| [CronCreate](Tool-CronCreate.md) | ตั้งเวลา prompt บน cron expression (ซ้ำ หรือ one-shot) |
| [CronDelete](Tool-CronDelete.md) | ยกเลิกงาน cron ที่ตั้งเวลาไว้ |
| [CronList](Tool-CronList.md) | แสดงรายการงาน cron ที่ตั้งเวลาไว้ |
| [ScheduleWakeup](Tool-ScheduleWakeup.md) | Self-pace การทำซ้ำ /loop โดยการตั้งเวลา wakeup ถัดไป |
| [PushNotification](Tool-PushNotification.md) | ส่งการแจ้งเตือน desktop/mobile ให้ผู้ใช้ |
| [RemoteTrigger](Tool-RemoteTrigger.md) | จัดการรูทีนของ claude.ai ที่เรียกใช้จากระยะไกล |
| [ReadNotifications](Tool-ReadNotifications.md) | อ่านการแจ้งเตือนที่ค้างอยู่ของเซสชัน |

## ส่วนขยาย

| เครื่องมือ | วัตถุประสงค์ |
|------|------|
| [Skill](Tool-Skill.md) | รันทักษะ (slash command) |

## MCP และส่วนขยาย

| เครื่องมือ | วัตถุประสงค์ |
|------|------|
| [ListMcpResources](Tool-ListMcpResources.md) | แสดงรายการ resource ที่ expose โดย MCP server ที่เชื่อมต่อ |
| [ReadMcpResource](Tool-ReadMcpResource.md) | อ่าน resource เดียวของ MCP server ด้วย URI |
| [ReadMcpResourceDir](Tool-ReadMcpResourceDir.md) | แสดงรายการ resource แบบ directory ของ MCP ด้วย URI |
| [SearchMcpRegistry](Tool-SearchMcpRegistry.md) | ค้นหา MCP connector registry ด้วย keyword |
| [SuggestConnectors](Tool-SuggestConnectors.md) | ดึงรายละเอียด connector จากผลการค้นหา registry |
| [ListConnectors](Tool-ListConnectors.md) | แสดงรายการ MCP connector ที่ติดตั้ง |
| [SuggestPluginInstall](Tool-SuggestPluginInstall.md) | แสดงการ์ดติดตั้ง plugin แบบ inline |
| [SuggestSkills](Tool-SuggestSkills.md) | แสดงการ์ดของ skill ที่เพิ่มได้ |
| [ListPlugins](Tool-ListPlugins.md) | แสดงรายการ plugin ของ claude.ai ที่เปิดใช้งาน |
| [ListSkills](Tool-ListSkills.md) | แสดงรายการ skill ของ claude.ai ที่เปิดใช้งาน |

## การรวมกับ IDE

| เครื่องมือ | วัตถุประสงค์ |
|------|------|
| [LSP](Tool-LSP.md) | การสืบค้นของ language-server (คำจำกัดความ, การอ้างอิง, สัญลักษณ์) |
