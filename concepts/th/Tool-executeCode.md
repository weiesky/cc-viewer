# executeCode (mcp__ide__executeCode)

## คำจำกัดความ

รันโค้ด Python ใน Jupyter kernel ของไฟล์ notebook ปัจจุบัน

## พารามิเตอร์

| พารามิเตอร์ | ประเภท | จำเป็น | คำอธิบาย |
|------|------|------|------|
| `code` | string | ใช่ | โค้ด Python ที่จะรัน |

## สถานการณ์การใช้งาน

**เหมาะสำหรับ:**
- รันโค้ดในสภาพแวดล้อม Jupyter notebook
- ทดสอบโค้ดสนิปเป็ต
- การวิเคราะห์ข้อมูลและการคำนวณ

**ไม่เหมาะสำหรับ:**
- การรันโค้ดนอกสภาพแวดล้อม Jupyter — ควรใช้ Bash
- การแก้ไขไฟล์ — ควรใช้ Edit หรือ Write

## ข้อควรระวัง

- นี่คือเครื่องมือ MCP (Model Context Protocol) ที่จัดเตรียมโดยการรวมกับ IDE
- โค้ดจะถูกรันใน Jupyter kernel ปัจจุบัน สถานะจะคงอยู่ระหว่างการเรียก
- เว้นแต่ผู้ใช้ร้องขออย่างชัดเจน ควรหลีกเลี่ยงการประกาศตัวแปรหรือแก้ไขสถานะ kernel
- สถานะจะสูญหายหลังจากรีสตาร์ท kernel

## ความสำคัญใน cc-viewer

executeCode เป็นเครื่องมือ MCP ปรากฏในอาร์เรย์ `tools` ของบันทึกคำร้องขอด้วยชื่อ `mcp__ide__executeCode` การเรียกและส่งคืนเป็นไปตามรูปแบบ `tool_use` / `tool_result` มาตรฐาน การเพิ่ม/ลบเครื่องมือ MCP ทำให้อาร์เรย์ tools เปลี่ยนแปลง ซึ่งอาจทำให้เกิดการสร้างแคชใหม่

## ข้อความต้นฉบับ

<textarea readonly>Execute python code in the Jupyter kernel for the current notebook file.
    
    All code will be executed in the current Jupyter kernel.
    
    Avoid declaring variables or modifying the state of the kernel unless the user
    explicitly asks for it.
    
    Any code executed will persist across calls to this tool, unless the kernel
    has been restarted.</textarea>
