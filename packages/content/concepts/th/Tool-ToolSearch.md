# ToolSearch

ดึง schema definition แบบเต็มของ "deferred tools" ตามต้องการเพื่อให้สามารถเรียกใช้ได้ เมื่อมีเครื่องมือจำนวนมากพร้อมใช้งาน บางตัวจะไม่ถูกโหลดไว้ล่วงหน้า — มันจะปรากฏเพียงชื่อภายในข้อความ `<system-reminder>` เท่านั้น จนกว่าจะดึง schema มา จะรู้แค่ชื่อและไม่มี parameter definition ดังนั้นจึงเรียกใช้เครื่องมือนั้นไม่ได้ `ToolSearch` รับ query หนึ่งตัว นำไปจับคู่กับรายการ deferred tools และคืน JSONSchema definition แบบสมบูรณ์ของเครื่องมือที่ตรงกันภายใน `<functions>` block เมื่อ schema ของเครื่องมือปรากฏในผลลัพธ์แล้ว ก็สามารถเรียกใช้ได้เหมือนกับเครื่องมือใด ๆ ที่ถูกนิยามไว้ที่ส่วนต้นของ prompt ทุกประการ

## เมื่อใดควรใช้

- คุณต้องการ deferred tool — ชื่อของมันปรากฏใน `<system-reminder>` แต่ไม่มี parameter definition สำหรับมันในรายการเครื่องมือระดับบนสุด
- คุณต้องการใช้เครื่องมือของ MCP server (เช่น Slack, Gmail, computer-use) ที่โหลดตามต้องการ
- คุณไม่แน่ใจชื่อเครื่องมือที่แน่นอนของความสามารถหนึ่ง และต้องการให้ตัวเลือกผุดขึ้นมาด้วย keyword ในครั้งเดียว

หาก schema ของเครื่องมืออยู่ใน context อยู่แล้ว อย่าค้นหาซ้ำ — แค่เรียกใช้มันได้เลย

## การเปิดใช้งาน

- เปิดตามค่าเริ่มต้น
- ปิดเมื่อ `ANTHROPIC_BASE_URL` ชี้ไปยัง endpoint ที่ไม่ใช่ของ Anthropic (เว้นแต่ตั้งค่า `ENABLE_TOOL_SEARCH`), เมื่อตั้งค่า `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`, เมื่อโมเดลไม่รองรับ tool-reference (โมเดล Vertex AI ก่อน Claude 4.5), หรือเมื่อถูกปฏิเสธผ่าน `"deny": ["ToolSearch"]`

## พารามิเตอร์

- `query` (string, required): query ที่ใช้ระบุตำแหน่ง deferred tools รองรับสามรูปแบบ:
  - `select:Read,Edit,Grep` — ดึงเครื่องมือเหล่านี้ด้วยชื่อที่แน่นอน
  - `notebook jupyter` — ค้นหาด้วย keyword คืนผลลัพธ์ที่ตรงที่สุดสูงสุด `max_results` รายการ
  - `+slack send` — กำหนดให้ `slack` ต้องปรากฏในชื่อเครื่องมือ แล้วจัดอันดับด้วยคำที่เหลือ
- `max_results` (number, optional): จำนวนผลลัพธ์สูงสุดที่จะคืนกลับ ค่าเริ่มต้นคือ 5

## ตัวอย่าง

### ตัวอย่างที่ 1: ดึงด้วยชื่อที่แน่นอน

```
ToolSearch(query="select:WebFetch,WebSearch", max_results=5)
```

### ตัวอย่างที่ 2: ค้นหาด้วย keyword

```
ToolSearch(query="notebook jupyter", max_results=5)
```

### ตัวอย่างที่ 3: โหลดชุดเครื่องมือ MCP ทั้งชุดในครั้งเดียว

เมื่อโหลดเครื่องมือทุกตัวของ MCP server แบบ bulk (เช่น computer-use) ให้ใช้ keyword search ครั้งเดียวแทนการเลือกทีละตัว — ชื่อ server ในฐานะ substring จะตรงกับเครื่องมือทุกตัวภายใต้ server นั้น:

```
ToolSearch(query="computer-use", max_results=30)
```

## หมายเหตุ

- ก่อนเรียกใช้ deferred tool คุณต้องดึง schema ของมันด้วย `ToolSearch` ก่อน — การเรียกใช้มันโดยตรงจะล้มเหลวเพราะขาด parameter definition
- เมื่อโหลดชุดเครื่องมือทั้งชุดแบบ bulk (เช่น เครื่องมือทั้งหมดของ MCP server) ให้เลือก keyword search ครั้งเดียวมากกว่า `select:` หลายครั้ง เพื่อลดจำนวนรอบการรับส่ง
- เมื่อดึง schema มาแล้ว เครื่องมือจะทำงานเหมือนเครื่องมือปกติทุกประการ อย่าค้นหาเครื่องมือเดิมซ้ำ
- ผลลัพธ์จะคืนกลับมาเป็น `<functions>` block แต่ละเครื่องมือเป็นหนึ่งบรรทัด `<function>{...}</function>` — เป็น encoding เดียวกับรายการเครื่องมือระดับบนสุด
