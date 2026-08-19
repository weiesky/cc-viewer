# Grep

ค้นหาเนื้อหาไฟล์โดยใช้ engine ripgrep รองรับ regular expression เต็มรูปแบบ, filter ตามประเภทไฟล์ และ output mode สามแบบเพื่อให้คุณสามารถแลกความแม่นยำกับความกระชับได้

## เมื่อใดควรใช้

- ค้นหาทุก call site ของ function หรือทุก reference ของ identifier
- ตรวจสอบว่า string หรือ error message ปรากฏที่ใดใน codebase หรือไม่
- นับ occurrence ของ pattern เพื่อประเมินผลกระทบก่อน refactor
- จำกัดการค้นหาเฉพาะประเภทไฟล์ (`type: "ts"`) หรือ glob (`glob: "**/*.tsx"`)
- ดึง match ข้ามบรรทัด เช่น นิยาม struct หลายบรรทัดหรือ block JSX ด้วย `multiline: true`

## พารามิเตอร์

- `pattern` (string, required): regular expression ที่จะค้นหา ใช้ syntax ของ ripgrep ดังนั้น literal brace ต้อง escape (เช่น `interface\{\}` เพื่อหา `interface{}`)
- `path` (string, optional): ไฟล์หรือ directory ที่จะค้นหา ค่าเริ่มต้นคือ working directory ปัจจุบัน
- `glob` (string, optional): filter ชื่อไฟล์ เช่น `*.js` หรือ `*.{ts,tsx}`
- `type` (string, optional): shortcut ประเภทไฟล์ เช่น `js`, `py`, `rust`, `go` มีประสิทธิภาพมากกว่า `glob` สำหรับภาษามาตรฐาน
- `output_mode` (enum, optional): `files_with_matches` (ค่าเริ่มต้น, ส่ง path เท่านั้น), `content` (ส่งบรรทัดที่ match), หรือ `count` (ส่งจำนวน match)
- `-i` (boolean, optional): match แบบไม่แยกตัวพิมพ์
- `-n` (boolean, optional): รวมหมายเลขบรรทัดใน mode `content` ค่าเริ่มต้น `true`
- `-A` (number, optional): จำนวนบรรทัด context แสดงหลังแต่ละ match (ต้องใช้ mode `content`)
- `-B` (number, optional): จำนวนบรรทัด context ก่อนแต่ละ match (ต้องใช้ mode `content`)
- `-C` / `context` (number, optional): จำนวนบรรทัด context ทั้งสองด้านของแต่ละ match
- `multiline` (boolean, optional): ให้ pattern ข้าม newline ได้ (`.` match `\n`) ค่าเริ่มต้น `false`
- `head_limit` (number, optional): จำกัดจำนวนบรรทัด, path ของไฟล์, หรือ count entry ที่ส่งกลับ ค่าเริ่มต้น 250; ส่ง `0` สำหรับไม่จำกัด (ใช้อย่างประหยัด)
- `offset` (number, optional): ข้าม N ผลลัพธ์แรกก่อนใช้ `head_limit` ค่าเริ่มต้น `0`

## ตัวอย่าง

### ตัวอย่างที่ 1: หา call site ทั้งหมดของ function
ตั้ง `pattern: "registerHandler\\("`, `output_mode: "content"`, และ `-C: 2` เพื่อดูบรรทัดโดยรอบของแต่ละการเรียก

### ตัวอย่างที่ 2: นับ match ข้ามประเภท
ตั้ง `pattern: "TODO"`, `type: "py"`, และ `output_mode: "count"` เพื่อดูจำนวน TODO ต่อไฟล์ใน Python source

### ตัวอย่างที่ 3: Multiline struct match
ใช้ `pattern: "struct Config \\{[\\s\\S]*?version"` ด้วย `multiline: true` เพื่อจับ field ที่ประกาศห่างหลายบรรทัดเข้าไปใน struct ของ Go

## หมายเหตุ

- ชอบ `Grep` มากกว่าการรัน `grep` หรือ `rg` ผ่าน `Bash` เสมอ; tool นี้ optimize สำหรับ permission ที่ถูกต้องและ output ที่มีโครงสร้าง
- Output mode เริ่มต้นคือ `files_with_matches` ซึ่งถูกที่สุด เปลี่ยนเป็น `content` เฉพาะเมื่อต้องการดูบรรทัดเอง
- Context flag (`-A`, `-B`, `-C`) จะถูกละเลยเว้นแต่ `output_mode` เป็น `content`
- ผลลัพธ์ขนาดใหญ่เผาผลาญ token ของ context ใช้ `head_limit`, `offset`, หรือ `glob`/`type` filter ที่แคบลงเพื่อรักษาการโฟกัส
- สำหรับการค้นหาชื่อไฟล์ ให้ใช้ `Glob` แทน; สำหรับการสืบสวนแบบเปิดกว้างข้ามหลายรอบ ให้ dispatch `Agent` ด้วย Explore agent
