# REPL

รัน JavaScript ใน Node.js vm context แบบ persistent ภายในเซสชัน รองรับ top-level `await` และตัวแปร/ฟังก์ชันที่กำหนดในการเรียกครั้งหนึ่งยังคงใช้งานได้ในการเรียกครั้งถัดไป

## เมื่อใดควรใช้

- การคำนวณเร็ว ๆ, การแปลงข้อมูล, หรือการจัดการ JSON ที่ทำในโค้ดง่ายกว่า shell one-liner
- การเขียนสคริปต์หลายขั้นตอนที่สถานะระหว่างกลางควรคงอยู่ระหว่างการเรียก (ตัวนับ, ผลลัพธ์สะสม)
- ลองพฤติกรรมของ API หรือไลบรารีแบบ interactive ก่อนเขียนลงไฟล์

## พารามิเตอร์

- `code` (string, required): โค้ด JavaScript ที่จะรัน รองรับ top-level await สถานะคงอยู่ระหว่างการเรียก
- `description` (string, optional): คำอธิบายที่ชัดเจนและกระชับของสิ่งที่สคริปต์นี้ทำ ในรูป active voice (5–10 คำ) เช่น "Trace upgrade message to its GrowthBook flag"
- `timeout` (number, optional): เวลาหมดเวลาในหน่วยมิลลิวินาที ค่าเริ่มต้นคือ 30000 สูงสุด 600000

## ตัวอย่าง

### ตัวอย่างที่ 1: คำนวณและนำสถานะกลับมาใช้

```
REPL(code="const counts = new Map(); ['a','b','a'].forEach(k => counts.set(k, (counts.get(k)||0)+1)); counts.get('a')")
```

คืนค่า `2` และ `counts` ยังคงถูกกำหนดไว้สำหรับการเรียก REPL ครั้งถัดไปในเซสชันเดียวกัน

### ตัวอย่างที่ 2: top-level await พร้อม timeout ที่นานขึ้น

```
REPL(
  code="const res = await fetch('https://example.com/api'); await res.json()",
  description="Fetch example API and parse JSON",
  timeout=60000
)
```

## หมายเหตุ

- สถานะเป็นแบบ per-session: การเริ่มเซสชันใหม่จะล้างคำจำกัดความทั้งหมด
- นี่คือสภาพแวดล้อม JavaScript (Node) — ใช้ Bash สำหรับคำสั่ง shell งานที่เกี่ยวข้องกับ filesystem มาก หรือ runtime ที่ไม่ใช่ JS
- โค้ดที่ทำงานนานควรตั้ง `timeout` อย่างชัดเจน ค่าเริ่มต้น 30 วินาทีจะฆ่าทุกอย่างที่ช้ากว่านั้น
