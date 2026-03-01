# Edit

## คำจำกัดความ

แก้ไขไฟล์ด้วยการแทนที่สตริงที่แม่นยำ แทนที่ `old_string` ด้วย `new_string` ในไฟล์

## พารามิเตอร์

| พารามิเตอร์ | ประเภท | จำเป็น | คำอธิบาย |
|------|------|------|------|
| `file_path` | string | ใช่ | พาธแบบสัมบูรณ์ของไฟล์ที่จะแก้ไข |
| `old_string` | string | ใช่ | ข้อความต้นฉบับที่จะถูกแทนที่ |
| `new_string` | string | ใช่ | ข้อความใหม่หลังการแทนที่ (ต้องแตกต่างจาก old_string) |
| `replace_all` | boolean | ไม่ | แทนที่ทุกรายการที่ตรงกันหรือไม่ ค่าเริ่มต้น `false` |

## สถานการณ์การใช้งาน

**เหมาะสำหรับ:**
- แก้ไขส่วนโค้ดเฉพาะในไฟล์ที่มีอยู่
- แก้ไขบัก อัปเดตลอจิก
- เปลี่ยนชื่อตัวแปร (ใช้ร่วมกับ `replace_all: true`)
- สถานการณ์ใดก็ตามที่ต้องการแก้ไขเนื้อหาไฟล์อย่างแม่นยำ

**ไม่เหมาะสำหรับ:**
- สร้างไฟล์ใหม่ — ควรใช้ Write
- เขียนใหม่ขนาดใหญ่ — อาจต้องใช้ Write เพื่อเขียนทับไฟล์ทั้งหมด

## ข้อควรระวัง

- ก่อนใช้ต้องอ่านไฟล์ผ่าน Read ก่อน มิฉะนั้นจะเกิดข้อผิดพลาด
- `old_string` ต้องไม่ซ้ำกันในไฟล์ มิฉะนั้นการแก้ไขจะล้มเหลว หากไม่ไม่ซ้ำกัน ให้เพิ่มบริบทเพื่อให้ไม่ซ้ำกัน หรือใช้ `replace_all`
- เมื่อแก้ไขข้อความต้องรักษาการเยื้องต้นฉบับ (tab/ช่องว่าง) อย่ารวมคำนำหน้าหมายเลขบรรทัดจากผลลัพธ์ Read
- ควรแก้ไขไฟล์ที่มีอยู่มากกว่าสร้างไฟล์ใหม่
- `new_string` ต้องแตกต่างจาก `old_string`

## ความสำคัญใน cc-viewer

การเรียก Edit ปรากฏในบันทึกคำร้องขอเป็น content block `tool_use` ซึ่ง `input` มี `old_string` และ `new_string` สามารถใช้ติดตามว่าโมเดลทำการแก้ไขอะไรในไฟล์

## ข้อความต้นฉบับ

<textarea readonly>Performs exact string replacements in files.

Usage:
- You must use your `Read` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file. 
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if `old_string` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use `replace_all` to change every instance of `old_string`.
- Use `replace_all` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.</textarea>
