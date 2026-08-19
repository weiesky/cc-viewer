# Edit

ดำเนินการแทนที่ string อย่างแม่นยำในไฟล์ที่มีอยู่แล้ว นี่คือวิธีที่แนะนำสำหรับการแก้ไขไฟล์เพราะส่งเฉพาะ diff เท่านั้น ทำให้การแก้ไขแม่นยำและตรวจสอบได้

## เมื่อใดควรใช้

- แก้ไขบั๊กใน function เดียวโดยไม่เขียนไฟล์ทั้งรอบใหม่
- อัปเดตค่า configuration, เวอร์ชัน string, หรือ import path
- เปลี่ยนชื่อ symbol ข้ามไฟล์ด้วย `replace_all`
- แทรก block ใกล้ anchor (ขยาย `old_string` ให้รวม context ใกล้เคียง แล้วระบุส่วนที่แทนที่)
- ใช้การแก้ไขเล็กๆ ที่มีขอบเขตดีเป็นส่วนหนึ่งของการ refactor หลายขั้นตอน

## พารามิเตอร์

- `file_path` (string, required): Absolute path ของไฟล์ที่จะแก้ไข
- `old_string` (string, required): ข้อความที่แน่นอนที่จะค้นหา ต้องตรงตัวอักขระทุกตัว รวมถึง whitespace และ indent
- `new_string` (string, required): ข้อความที่จะแทนที่ ต้องต่างจาก `old_string`
- `replace_all` (boolean, optional): เมื่อ `true` จะแทนที่ทุก occurrence ของ `old_string` ค่าเริ่มต้นคือ `false` ซึ่งต้องการให้ match เป็นเอกลักษณ์

## ตัวอย่าง

### ตัวอย่างที่ 1: แก้ call site เดียว
ตั้ง `old_string` เป็นบรรทัดที่แน่นอน `const port = 3000;` และ `new_string` เป็น `const port = process.env.PORT ?? 3000;` การ match เป็นเอกลักษณ์ ดังนั้น `replace_all` คงค่าเริ่มต้นได้

### ตัวอย่างที่ 2: เปลี่ยนชื่อ symbol ข้ามไฟล์
เพื่อเปลี่ยนชื่อ `getUser` เป็น `fetchUser` ทุกที่ใน `api.ts` ให้ตั้ง `old_string: "getUser"`, `new_string: "fetchUser"`, และ `replace_all: true`

### ตัวอย่างที่ 3: Disambiguate snippet ที่ซ้ำกัน
หาก `return null;` ปรากฏในหลาย branch ให้ขยาย `old_string` ให้รวม context โดยรอบ (เช่น บรรทัด `if` ก่อนหน้า) เพื่อให้ match เป็นเอกลักษณ์ มิฉะนั้น tool จะ error ออกมาแทนการเดา

## หมายเหตุ

- คุณต้องเรียก `Read` บนไฟล์อย่างน้อยหนึ่งครั้งใน session ปัจจุบันก่อนที่ `Edit` จะยอมรับการเปลี่ยนแปลง คำนำหน้าหมายเลขบรรทัดจาก output ของ `Read` ไม่ใช่ส่วนหนึ่งของเนื้อหาไฟล์ อย่ารวมเข้าใน `old_string` หรือ `new_string`
- Whitespace ต้อง match แบบตรงตัว ใส่ใจกับ tab กับ space และ space ต่อท้าย โดยเฉพาะใน YAML, Makefile, และ Python
- หาก `old_string` ไม่เป็นเอกลักษณ์และ `replace_all` เป็น `false` การแก้ไขจะล้มเหลว ให้ขยาย context หรือเปิด `replace_all`
- ชอบ `Edit` มากกว่า `Write` เมื่อไฟล์มีอยู่แล้ว; `Write` จะ overwrite ไฟล์ทั้งหมดและทำเนื้อหาที่ไม่เกี่ยวข้องหายหากคุณไม่ระวัง
- สำหรับการแก้ไขหลายอย่างที่ไม่เกี่ยวข้องกันในไฟล์เดียวกัน ให้ออก `Edit` หลายครั้งต่อเนื่องแทนที่จะแทนที่แบบใหญ่และเปราะบาง
- หลีกเลี่ยงการใส่ emoji, marketing copy, หรือ documentation block ที่ไม่ได้ร้องขอเมื่อแก้ไข source file
