# Projects

จัดการเอกสารโปรเจกต์ในฐานความรู้โปรเจกต์ Claude ของผู้ใช้: อ่าน, ค้นหา, เขียน, และลบเอกสาร หรือดึงข้อมูลโปรเจกต์

## เมื่อใดควรใช้

- บันทึกเอกสาร (deliverable, บันทึกย่อ, เอกสารอ้างอิง) ลงในโปรเจกต์ของผู้ใช้เพื่อให้อยู่รอดหลังเซสชันจบ
- อ่านหรือค้นหาเอกสารโปรเจกต์ที่มีอยู่เพื่อยึดงานปัจจุบันกับบริบทก่อนหน้า
- อัปโหลดไฟล์ในเครื่องเข้าสู่โปรเจกต์โดยไม่ต้องโหลดเนื้อหาเข้าสู่ context
- ลบเอกสารโปรเจกต์ที่ล้าสมัย

## พารามิเตอร์

- `method` (string, required): หนึ่งใน `project_info`, `project_read`, `project_search`, `project_write`, `project_delete`
- `path` (string, optional): สำหรับ `project_read`/`project_write`/`project_delete`: path ของเอกสาร สำหรับ `project_write`: path ที่มีอยู่แล้วจะถูกแทนที่ที่เดิม ชื่อไฟล์เปล่าใหม่ (ไม่มี "/") จะถูกจัดเข้า namespace `claude/<name>`
- `content` (string, optional): สำหรับ `project_write`: ข้อความเอกสารแบบ inline ใช้ร่วมกับ `local_path` ไม่ได้ (เลือกอย่างใดอย่างหนึ่ง)
- `local_path` (string, optional): สำหรับ `project_write`: ไฟล์ภายใน working directory ที่จะอัปโหลด — เนื้อหาไม่เข้าสู่ context ของคุณเลย ใช้ร่วมกับ `content` ไม่ได้ (เลือกอย่างใดอย่างหนึ่ง)
- `present_to_user` (boolean, optional): สำหรับ `project_write`: ทำเครื่องหมายเอกสารนี้เป็น deliverable ที่ผู้ใช้ต้องเห็น ค่าเริ่มต้นคือ false ปล่อยไม่ตั้งค่าสำหรับการบันทึกปกติและการเขียนแบบ bulk
- `query` (string, optional): สำหรับ `project_search`: query ค้นหาฐานความรู้
- `n` (number, optional): สำหรับ `project_search`: จำนวนผลลัพธ์ (ค่าเริ่มต้น 5)

## ตัวอย่าง

### ตัวอย่างที่ 1: เขียน deliverable ลงในโปรเจกต์

```
Projects(
  method="project_write",
  path="claude/migration-plan.md",
  local_path="./migration-plan.md",
  present_to_user=true
)
```

อัปโหลดไฟล์ในเครื่องโดยไม่ดึงเนื้อหาเข้าสู่ context และทำเครื่องหมายเป็น deliverable ของผู้ใช้

### ตัวอย่างที่ 2: ค้นหาฐานความรู้

```
Projects(method="project_search", query="authentication refresh tokens", n=5)
```

## หมายเหตุ

- `content` ใช้สำหรับข้อความที่คุณเขียนแบบ inline ส่วน `local_path` ใช้สำหรับสิ่งที่อยู่บนดิสก์แล้ว — อย่าใช้สองอย่างปนกัน
- ใช้ `present_to_user=true` อย่างประหยัด: เฉพาะเอกสารเดียวที่ผู้ใช้ขอหรือต้องดำเนินการเท่านั้น
