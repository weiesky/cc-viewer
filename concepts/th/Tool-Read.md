# Read

## คำจำกัดความ

อ่านเนื้อหาไฟล์จากระบบไฟล์ในเครื่อง รองรับไฟล์ข้อความ รูปภาพ PDF และ Jupyter notebook

## พารามิเตอร์

| พารามิเตอร์ | ประเภท | จำเป็น | คำอธิบาย |
|------|------|------|------|
| `file_path` | string | ใช่ | พาธแบบสัมบูรณ์ของไฟล์ |
| `offset` | number | ไม่ | หมายเลขบรรทัดเริ่มต้น (สำหรับอ่านไฟล์ขนาดใหญ่แบบแบ่งส่วน) |
| `limit` | number | ไม่ | จำนวนบรรทัดที่จะอ่าน (สำหรับอ่านไฟล์ขนาดใหญ่แบบแบ่งส่วน) |
| `pages` | string | ไม่ | ช่วงหน้า PDF (เช่น "1-5", "3", "10-20") ใช้ได้เฉพาะกับ PDF |

## สถานการณ์การใช้งาน

**เหมาะสำหรับ:**
- อ่านไฟล์โค้ด ไฟล์การตั้งค่า และไฟล์ข้อความอื่นๆ
- ดูไฟล์รูปภาพ (Claude เป็นโมเดลมัลติโมดัล)
- อ่านเอกสาร PDF
- อ่าน Jupyter notebook (ส่งคืนเซลล์ทั้งหมดพร้อมผลลัพธ์)
- อ่านหลายไฟล์พร้อมกันเพื่อรับบริบท

**ไม่เหมาะสำหรับ:**
- อ่านไดเรกทอรี — ควรใช้คำสั่ง `ls` ของ Bash
- การสำรวจโค้ดเบสแบบเปิด — ควรใช้ Task (ประเภท Explore)

## ข้อควรระวัง

- พาธต้องเป็นแบบสัมบูรณ์ ไม่ใช่แบบสัมพัทธ์
- ค่าเริ่มต้นอ่าน 2000 บรรทัดแรกของไฟล์
- บรรทัดที่เกิน 2000 ตัวอักษรจะถูกตัดทอน
- ผลลัพธ์ใช้รูปแบบ `cat -n` หมายเลขบรรทัดเริ่มจาก 1
- PDF ขนาดใหญ่ (เกิน 10 หน้า) ต้องระบุพารามิเตอร์ `pages` สูงสุด 20 หน้าต่อครั้ง
- การอ่านไฟล์ที่ไม่มีอยู่จะส่งคืนข้อผิดพลาด (ไม่ทำให้ล่ม)
- สามารถเรียก Read หลายครั้งพร้อมกันในข้อความเดียว

## ความสำคัญใน cc-viewer

การเรียก Read ปรากฏในบันทึกคำร้องขอเป็นคู่ content block `tool_use` (การเรียก) และ `tool_result` (เนื้อหาที่ส่งคืน) โดย `tool_result` มีเนื้อหาจริงของไฟล์ สามารถใช้วิเคราะห์ว่าโมเดลอ่านไฟล์ใดบ้าง

## ข้อความต้นฉบับ

<textarea readonly>Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to 2000 lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters
- Any lines longer than 2000 characters will be truncated
- Results are returned using cat -n format, with line numbers starting at 1
- This tool allows Claude Code to read images (eg PNG, JPG, etc). When reading an image file the contents are presented visually as Claude Code is a multimodal LLM.
- This tool can read PDF files (.pdf). For large PDFs (more than 10 pages), you MUST provide the pages parameter to read specific page ranges (e.g., pages: "1-5"). Reading a large PDF without the pages parameter will fail. Maximum 20 pages per request.
- This tool can read Jupyter notebooks (.ipynb files) and returns all cells with their outputs, combining code, text, and visualizations.
- This tool can only read files, not directories. To read a directory, use an ls command via the Bash tool.
- You can call multiple tools in a single response. It is always better to speculatively read multiple potentially useful files in parallel.
- You will regularly be asked to read screenshots. If the user provides a path to a screenshot, ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.</textarea>
