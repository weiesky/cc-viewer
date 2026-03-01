# Glob

## คำจำกัดความ

เครื่องมือจับคู่รูปแบบชื่อไฟล์ที่รวดเร็ว รองรับโค้ดเบสทุกขนาด ส่งคืนพาธไฟล์ที่ตรงกันเรียงตามเวลาแก้ไข

## พารามิเตอร์

| พารามิเตอร์ | ประเภท | จำเป็น | คำอธิบาย |
|------|------|------|------|
| `pattern` | string | ใช่ | รูปแบบ glob (เช่น `**/*.js`, `src/**/*.ts`) |
| `path` | string | ไม่ | ไดเรกทอรีค้นหา ค่าเริ่มต้นคือไดเรกทอรีทำงานปัจจุบัน อย่าส่ง "undefined" หรือ "null" |

## สถานการณ์การใช้งาน

**เหมาะสำหรับ:**
- ค้นหาไฟล์ตามรูปแบบชื่อ
- ค้นหาไฟล์ทั้งหมดของประเภทเฉพาะ (เช่น ไฟล์ `.tsx` ทั้งหมด)
- ระบุตำแหน่งไฟล์เมื่อค้นหาคำจำกัดความคลาสเฉพาะ (เช่น `class Foo`)
- สามารถเรียก Glob หลายครั้งพร้อมกันในข้อความเดียว

**ไม่เหมาะสำหรับ:**
- ค้นหาเนื้อหาไฟล์ — ควรใช้ Grep
- การสำรวจแบบเปิดที่ต้องค้นหาหลายรอบ — ควรใช้ Task (ประเภท Explore)

## ข้อควรระวัง

- รองรับไวยากรณ์ glob มาตรฐาน: `*` จับคู่ระดับเดียว, `**` จับคู่หลายระดับ, `{}` จับคู่หลายตัวเลือก
- ผลลัพธ์เรียงตามเวลาแก้ไข
- แนะนำให้ใช้มากกว่าคำสั่ง `find` ของ Bash

## ความสำคัญใน cc-viewer

การเรียก Glob ปรากฏในบันทึกคำร้องขอเป็นคู่ content block `tool_use` / `tool_result` โดย `tool_result` มีรายการพาธไฟล์ที่ตรงกัน

## ข้อความต้นฉบับ

<textarea readonly>- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead
- You can call multiple tools in a single response. It is always better to speculatively perform multiple searches in parallel if they are potentially useful.</textarea>
