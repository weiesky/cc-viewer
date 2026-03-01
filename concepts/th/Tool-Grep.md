# Grep

## คำจำกัดความ

เครื่องมือค้นหาเนื้อหาที่ทรงพลังโดยใช้ ripgrep รองรับนิพจน์ทั่วไป การกรองตามประเภทไฟล์ และโหมดผลลัพธ์หลายแบบ

## พารามิเตอร์

| พารามิเตอร์ | ประเภท | จำเป็น | คำอธิบาย |
|------|------|------|------|
| `pattern` | string | ใช่ | รูปแบบค้นหาด้วยนิพจน์ทั่วไป |
| `path` | string | ไม่ | พาธค้นหา (ไฟล์หรือไดเรกทอรี) ค่าเริ่มต้นคือไดเรกทอรีทำงานปัจจุบัน |
| `glob` | string | ไม่ | ตัวกรองชื่อไฟล์ (เช่น `*.js`, `*.{ts,tsx}`) |
| `type` | string | ไม่ | ตัวกรองประเภทไฟล์ (เช่น `js`, `py`, `rust`) มีประสิทธิภาพมากกว่า glob |
| `output_mode` | enum | ไม่ | โหมดผลลัพธ์: `files_with_matches` (ค่าเริ่มต้น), `content`, `count` |
| `-i` | boolean | ไม่ | ค้นหาโดยไม่คำนึงถึงตัวพิมพ์ใหญ่-เล็ก |
| `-n` | boolean | ไม่ | แสดงหมายเลขบรรทัด (เฉพาะโหมด content) ค่าเริ่มต้น true |
| `-A` | number | ไม่ | จำนวนบรรทัดที่แสดงหลังการจับคู่ |
| `-B` | number | ไม่ | จำนวนบรรทัดที่แสดงก่อนการจับคู่ |
| `-C` / `context` | number | ไม่ | จำนวนบรรทัดที่แสดงก่อนและหลังการจับคู่ |
| `head_limit` | number | ไม่ | จำกัดจำนวนรายการผลลัพธ์ ค่าเริ่มต้น 0 (ไม่จำกัด) |
| `offset` | number | ไม่ | ข้ามผลลัพธ์ N รายการแรก |
| `multiline` | boolean | ไม่ | เปิดใช้โหมดจับคู่หลายบรรทัด ค่าเริ่มต้น false |

## สถานการณ์การใช้งาน

**เหมาะสำหรับ:**
- ค้นหาสตริงหรือรูปแบบเฉพาะในโค้ดเบส
- ค้นหาตำแหน่งการใช้งานของฟังก์ชัน/ตัวแปร
- กรองผลลัพธ์การค้นหาตามประเภทไฟล์
- นับจำนวนการจับคู่

**ไม่เหมาะสำหรับ:**
- ค้นหาไฟล์ตามชื่อ — ควรใช้ Glob
- การสำรวจแบบเปิดที่ต้องค้นหาหลายรอบ — ควรใช้ Task (ประเภท Explore)

## ข้อควรระวัง

- ใช้ไวยากรณ์ ripgrep (ไม่ใช่ grep) อักขระพิเศษเช่นวงเล็บปีกกาต้องใช้ escape
- โหมด `files_with_matches` ส่งคืนเฉพาะพาธไฟล์ มีประสิทธิภาพสูงสุด
- โหมด `content` ส่งคืนเนื้อหาบรรทัดที่ตรงกัน รองรับบรรทัดบริบท
- การจับคู่หลายบรรทัดต้องตั้งค่า `multiline: true`
- ควรใช้เครื่องมือ Grep แทนคำสั่ง `grep` หรือ `rg` ใน Bash เสมอ

## ความสำคัญใน cc-viewer

การเรียก Grep ปรากฏในบันทึกคำร้องขอเป็นคู่ content block `tool_use` / `tool_result` โดย `tool_result` มีผลลัพธ์การค้นหา

## ข้อความต้นฉบับ

<textarea readonly>A powerful search tool built on ripgrep

  Usage:
  - ALWAYS use Grep for search tasks. NEVER invoke `grep` or `rg` as a Bash command. The Grep tool has been optimized for correct permissions and access.
  - Supports full regex syntax (e.g., "log.*Error", "function\s+\w+")
  - Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")
  - Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts
  - Use Agent tool for open-ended searches requiring multiple rounds
  - Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping (use `interface\{\}` to find `interface{}` in Go code)
  - Multiline matching: By default patterns match within single lines only. For cross-line patterns like `struct \{[\s\S]*?field`, use `multiline: true`
</textarea>
