# SendUserFile

ส่งไฟล์หนึ่งไฟล์ขึ้นไปให้ผู้ใช้ — artifact ที่สร้างขึ้น, ภาพหน้าจอ, รายงาน — พร้อมควบคุมวิธีที่ client นำเสนอ

## เมื่อใดควรใช้

- คุณสร้างไฟล์ที่ผู้ใช้ต้องการ (รายงาน, รูปภาพ, หน้า HTML) และต้องการนำเสนอ ไม่ใช่แค่บอก path ของมัน
- ตอบกลับพร้อมไฟล์แนบ (`status="normal"`) หรือนำเสนอล่วงหน้าสิ่งที่ผู้ใช้ยังไม่ได้ขอแต่ต้องเห็นตอนนี้ (`status="proactive"`)

## การเปิดใช้งาน

- พร้อมใช้งานเมื่อไคลเอนต์ Remote Control เชื่อมต่ออยู่ หรือเซสชันทำงานในสภาพแวดล้อมคลาวด์ที่จัดการ (เช่น Claude Code on the web) เท่านั้น
- ไม่พร้อมใช้งานบน Amazon Bedrock, Google Cloud, หรือ Microsoft Foundry
- ต้องให้เซสชันอนุญาตการส่งไฟล์ (ความสามารถที่ gated ด้วย settings/feature) ไม่มีให้ใน brief mode

## พารามิเตอร์

- `files` (array of strings, required): path ของไฟล์ (absolute หรือ relative กับ cwd) ที่จะส่งให้ผู้ใช้ ต้องส่งเป็น array เสมอแม้มีไฟล์เดียว
- `caption` (string, optional): คำบรรยายสั้น ๆ สำหรับไฟล์
- `status` (string, required): `proactive` เมื่อนำเสนอไฟล์ที่ผู้ใช้ยังไม่ได้ขอและต้องเห็นตอนนี้ — artifact ที่สร้างขึ้น, รายงานที่เสร็จแล้ว; `normal` เมื่อตอบกลับสิ่งที่ผู้ใช้เพิ่งพูด
- `display` (string, optional): `render` เปิดไฟล์แบบ inline ใน side panel (HTML, SVG, Mermaid, รูปภาพ, PDF); `attach` แสดงเพียงการ์ดดาวน์โหลด (deliverable ที่ผู้ใช้จะบันทึกและเปิดที่อื่น) ละเว้นเพื่อให้ client ตัดสินใจตามประเภทไฟล์

## ตัวอย่าง

### ตัวอย่างที่ 1: ส่งมอบรายงานที่สร้างขึ้น

```
SendUserFile(
  files=["./out/weekly-report.html"],
  caption="Weekly usage report",
  status="proactive",
  display="render"
)
```

## หมายเหตุ

- เลือก `display="attach"` สำหรับไฟล์ที่ผู้ใช้บันทึกและเปิดในแอปอื่น ส่วน `render` สำหรับสิ่งที่ควรดูทันที
