# NotebookEdit

## คำจำกัดความ

แทนที่ แทรก หรือลบเซลล์เฉพาะใน Jupyter notebook (ไฟล์ .ipynb)

## พารามิเตอร์

| พารามิเตอร์ | ประเภท | จำเป็น | คำอธิบาย |
|------|------|------|------|
| `notebook_path` | string | ใช่ | พาธแบบสัมบูรณ์ของไฟล์ notebook |
| `new_source` | string | ใช่ | เนื้อหาใหม่ของเซลล์ |
| `cell_id` | string | ไม่ | ID ของเซลล์ที่จะแก้ไข ในโหมดแทรก เซลล์ใหม่จะถูกแทรกหลัง ID นี้ |
| `cell_type` | enum | ไม่ | ประเภทเซลล์: `code` หรือ `markdown` จำเป็นในโหมดแทรก |
| `edit_mode` | enum | ไม่ | โหมดแก้ไข: `replace` (ค่าเริ่มต้น), `insert`, `delete` |

## สถานการณ์การใช้งาน

**เหมาะสำหรับ:**
- แก้ไขเซลล์โค้ดหรือ markdown ใน Jupyter notebook
- เพิ่มเซลล์ใหม่ใน notebook
- ลบเซลล์ใน notebook

## ข้อควรระวัง

- `cell_number` เป็นดัชนีเริ่มจาก 0
- โหมด `insert` แทรกเซลล์ใหม่ที่ตำแหน่งที่ระบุ
- โหมด `delete` ลบเซลล์ที่ตำแหน่งที่ระบุ
- พาธต้องเป็นแบบสัมบูรณ์

## ความสำคัญใน cc-viewer

การเรียก NotebookEdit ปรากฏในบันทึกคำร้องขอเป็น content block `tool_use` ซึ่งบันทึกการดำเนินการแก้ไขเฉพาะที่ทำกับ notebook

## ข้อความต้นฉบับ

<textarea readonly>Completely replaces the contents of a specific cell in a Jupyter notebook (.ipynb file) with new source. Jupyter notebooks are interactive documents that combine code, text, and visualizations, commonly used for data analysis and scientific computing. The notebook_path parameter must be an absolute path, not a relative path. The cell_number is 0-indexed. Use edit_mode=insert to add a new cell at the index specified by cell_number. Use edit_mode=delete to delete the cell at the index specified by cell_number.</textarea>
