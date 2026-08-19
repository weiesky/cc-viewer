# NotebookEdit

แก้ไข cell เดียวใน Jupyter notebook (`.ipynb`) รองรับการแทนที่ source ของ cell, แทรก cell ใหม่, หรือลบ cell ที่มีอยู่ขณะรักษาโครงสร้างที่เหลือของ notebook

## เมื่อใดควรใช้

- แก้ไขหรืออัปเดต code cell ใน notebook การวิเคราะห์โดยไม่ต้องเขียนไฟล์ทั้งหมดใหม่
- สลับ markdown cell เพื่อปรับปรุงเรื่องราวหรือเพิ่ม documentation
- แทรก code หรือ markdown cell ใหม่ที่ตำแหน่งที่ทราบใน notebook ที่มีอยู่
- ลบ cell ที่ล้าสมัยหรือเสียหายเพื่อให้ cell ปลายทางไม่ขึ้นกับมันอีกต่อไป
- เตรียม notebook ที่ทำซ้ำได้โดยการ iterate ทีละ cell

## พารามิเตอร์

- `notebook_path` (string, required): Absolute path ไปยังไฟล์ `.ipynb` Path แบบ relative จะถูกปฏิเสธ
- `new_source` (string, required): source ใหม่ของ cell สำหรับ `replace` และ `insert` จะกลายเป็นเนื้อหา cell; สำหรับ `delete` จะถูกละเลยแต่ยังคงต้องมีตาม schema
- `cell_id` (string, optional): ID ของ cell เป้าหมาย ใน mode `replace` และ `delete`, tool จะทำงานบน cell นี้ ใน mode `insert`, cell ใหม่จะถูกแทรกหลัง cell ที่มี ID นี้ทันที; ละเว้นเพื่อแทรกที่ด้านบนของ notebook
- `cell_type` (enum, optional): `code` หรือ `markdown` จำเป็นเมื่อ `edit_mode` เป็น `insert` เมื่อละเว้นระหว่าง `replace`, ประเภทของ cell ที่มีอยู่จะถูกรักษาไว้
- `edit_mode` (enum, optional): `replace` (ค่าเริ่มต้น), `insert`, หรือ `delete`

## ตัวอย่าง

### ตัวอย่างที่ 1: แทนที่ code cell ที่มีบั๊ก
เรียก `NotebookEdit` ด้วย `notebook_path` ตั้งเป็น absolute path, `cell_id` ตั้งเป็น ID ของ cell เป้าหมาย, และ `new_source` มี Python code ที่แก้แล้ว ปล่อย `edit_mode` เป็นค่าเริ่มต้น `replace`

### ตัวอย่างที่ 2: แทรกคำอธิบาย markdown
เพื่อเพิ่ม markdown cell ทันทีหลัง cell `setup` ที่มีอยู่ ให้ตั้ง `edit_mode: "insert"`, `cell_type: "markdown"`, `cell_id` เป็น ID ของ setup cell, และใส่เนื้อหาใน `new_source`

### ตัวอย่างที่ 3: ลบ cell ที่ค้าง
ตั้ง `edit_mode: "delete"` และจัดหา `cell_id` ของ cell ที่จะลบ จัดหา string ใดก็ได้สำหรับ `new_source`; จะไม่ถูกใช้

## หมายเหตุ

- ส่ง absolute path เสมอ `NotebookEdit` ไม่ resolve relative path ตาม working directory
- Tool เขียน cell ที่ targeted เท่านั้น; execution count, output, และ metadata ของ cell ที่ไม่เกี่ยวข้องยังคงไม่ถูกแตะ
- การแทรกโดยไม่มี `cell_id` วาง cell ใหม่ที่จุดเริ่มต้นสุดของ notebook
- `cell_type` จำเป็นสำหรับ insert สำหรับ replace ให้ละเว้นเว้นแต่คุณต้องการแปลง code cell เป็น markdown หรือกลับกัน
- เพื่อตรวจสอบ cell และเอา ID ของมัน ให้ใช้ tool `Read` บน notebook ก่อน; มันจะส่งคืน cell พร้อมเนื้อหาและ output
- ใช้ `Edit` ปกติสำหรับไฟล์ source ธรรมดา; `NotebookEdit` เฉพาะสำหรับ JSON `.ipynb` และเข้าใจโครงสร้าง cell
