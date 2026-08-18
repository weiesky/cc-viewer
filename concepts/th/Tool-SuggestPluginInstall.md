# SuggestPluginInstall

แสดงการ์ดติดตั้ง plugin แบบ inline จากผลลัพธ์ของ `SearchPlugins` โดยผูกข้อเสนอ plugin เข้ากับคำขอของผู้ใช้

## เมื่อใดควรใช้

- การค้นหา plugin ผุด plugin ที่ตรงกับสิ่งที่ผู้ใช้พยายามทำ และคุณต้องการเสนอให้ติดตั้ง

## การเปิดใช้งาน

- เฉพาะเมื่อไคลเอนต์ Remote Control เชื่อมต่ออยู่ หรือเซสชันทำงานในสภาพแวดล้อมคลาวด์ที่จัดการ
- ปิดใช้งานภายใต้การตั้งค่า HIPAA ขององค์กร
- ไม่มีใน brief mode

## พารามิเตอร์

- `contextLabel` (string, required): หัวข้อสั้น ๆ ที่ผูกข้อเสนอเข้ากับคำขอของผู้ใช้ (ไม่เกิน 128 ตัวอักษร)
- `plugins` (array, required): plugin ที่มาจากผลลัพธ์ของ `SearchPlugins` — 1–16 รายการ แต่ละรายการประกอบด้วย:
  - `pluginId` (string, required)
  - `pluginName` (string, required)
  - `description` (string, required)
  - `skills` (array, optional): รายการ `{name, description?}` ไม่เกิน 32 รายการ อธิบาย skill ของ plugin

## ตัวอย่าง

### ตัวอย่างที่ 1: เสนอ plugin ที่ตรงกัน

```
SuggestPluginInstall(
  contextLabel="For reviewing pull requests",
  plugins=[{pluginId="pr-toolkit", pluginName="PR Toolkit", description="Review helpers"}]
)
```

การ์ดถูกแสดงให้ผู้ใช้ การเปิดใช้งาน plugin เกิดขึ้นแยกต่างหาก เรียก `ListPlugins` ในการติดตามผลเพื่อค้นพบว่าติดตั้งอะไรไปจริง ๆ

## หมายเหตุ

- ใส่เฉพาะ plugin ที่มาจากผลการค้นหาเท่านั้น — อย่าคิดค้นรายการ plugin เอง
