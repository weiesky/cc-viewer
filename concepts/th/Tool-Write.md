# Write

## คำจำกัดความ

เขียนเนื้อหาลงในระบบไฟล์ในเครื่อง หากไฟล์มีอยู่แล้วจะถูกเขียนทับ

## พารามิเตอร์

| พารามิเตอร์ | ประเภท | จำเป็น | คำอธิบาย |
|------|------|------|------|
| `file_path` | string | ใช่ | พาธแบบสัมบูรณ์ของไฟล์ (ต้องเป็นพาธแบบสัมบูรณ์) |
| `content` | string | ใช่ | เนื้อหาที่จะเขียน |

## สถานการณ์การใช้งาน

**เหมาะสำหรับ:**
- สร้างไฟล์ใหม่
- เมื่อต้องเขียนเนื้อหาไฟล์ใหม่ทั้งหมด

**ไม่เหมาะสำหรับ:**
- แก้ไขเนื้อหาบางส่วนในไฟล์ — ควรใช้ Edit
- ไม่ควรสร้างไฟล์เอกสาร (*.md) หรือ README โดยอัตโนมัติ เว้นแต่ผู้ใช้ร้องขออย่างชัดเจน

## ข้อควรระวัง

- หากไฟล์เป้าหมายมีอยู่แล้ว ต้องอ่านผ่าน Read ก่อน มิฉะนั้นจะล้มเหลว
- จะเขียนทับเนื้อหาทั้งหมดของไฟล์ที่มีอยู่
- ควรใช้ Edit สำหรับแก้ไขไฟล์ที่มีอยู่ Write ใช้เฉพาะสำหรับสร้างไฟล์ใหม่หรือเขียนใหม่ทั้งหมด

## ความสำคัญใน cc-viewer

การเรียก Write ปรากฏในบันทึกคำร้องขอเป็น content block `tool_use` ซึ่ง `input.content` มีเนื้อหาที่เขียนทั้งหมด

## ข้อความต้นฉบับ

<textarea readonly>Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.</textarea>
