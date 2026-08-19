# Bash

รันคำสั่ง shell ใน working directory แบบ persistent และส่ง stdout/stderr กลับ เหมาะสงวนไว้สำหรับการดำเนินการที่ไม่มี tool เฉพาะของ Claude Code สามารถแสดงออกได้ เช่น การรัน git, npm, docker, หรือ build script

## เมื่อใดควรใช้

- การทำงาน git (`git status`, `git diff`, `git commit`, `gh pr create`)
- การรัน package manager และ build tool (`npm install`, `npm run build`, `pytest`, `cargo build`)
- การ launch process ที่รันนาน (dev server, watcher) ใน background ด้วย `run_in_background`
- การเรียก CLI เฉพาะโดเมน (`docker`, `terraform`, `kubectl`, `gh`) ที่ไม่มี built-in เทียบเท่า
- การเชื่อมขั้นตอนที่ต้องพึ่งพากันด้วย `&&` เมื่อลำดับมีความสำคัญ

## พารามิเตอร์

- `command` (string, required): คำสั่ง shell ที่แน่นอนที่จะรัน
- `description` (string, required): สรุปสั้นในรูปประโยค active voice (5-10 คำสำหรับคำสั่งง่าย; context มากขึ้นสำหรับคำสั่งที่ piped หรือไม่ชัดเจน)
- `timeout` (number, optional): Timeout เป็น millisecond สูงสุด `600000` (10 นาที) ค่าเริ่มต้นคือ `120000` (2 นาที)
- `run_in_background` (boolean, optional): เมื่อ `true` คำสั่งจะรันแบบแยกและคุณจะได้รับแจ้งเมื่อเสร็จสิ้น อย่าเติม `&` เอง

## ตัวอย่าง

### ตัวอย่างที่ 1: ตรวจสอบสถานะ repo ก่อน commit
เรียกใช้ `git status` และ `git diff --stat` เป็น `Bash` สองตัวพร้อมกันในข้อความเดียวเพื่อรวบรวม context อย่างรวดเร็ว จากนั้นประกอบ commit ในการเรียกต่อไป

### ตัวอย่างที่ 2: เชื่อมขั้นตอน build ที่ต้องพึ่งพากัน
ใช้การเรียกเดียว เช่น `npm ci && npm run build && npm test` เพื่อให้แต่ละขั้นตอนรันเฉพาะเมื่อขั้นก่อนหน้าสำเร็จ ใช้ `;` เฉพาะเมื่อคุณตั้งใจต้องการให้ขั้นตอนภายหลังรันแม้ว่าจะล้มเหลว

### ตัวอย่างที่ 3: Dev server ที่รันนาน
เรียก `npm run dev` ด้วย `run_in_background: true` คุณจะได้รับแจ้งเมื่อมันออก อย่า poll ด้วย sleep loop; วิเคราะห์ความล้มเหลวแทนที่จะ retry แบบไร้ทิศทาง

## หมายเหตุ

- Working directory คงอยู่ระหว่างการเรียก แต่ shell state (exported variable, shell function, alias) ไม่คงอยู่ ชอบ absolute path และหลีกเลี่ยง `cd` เว้นแต่ผู้ใช้ขอ
- ชอบ tool เฉพาะมากกว่า shell piped equivalents: `Glob` แทน `find`/`ls`, `Grep` แทน `grep`/`rg`, `Read` แทน `cat`/`head`/`tail`, `Edit` แทน `sed`/`awk`, `Write` แทน `echo >` หรือ heredoc, และ assistant text ธรรมดาแทน `echo`/`printf` สำหรับ output ที่แสดงแก่ผู้ใช้
- ใส่ double quote ให้ path ที่มี space (เช่น `"/Users/me/My Project/file.txt"`)
- สำหรับคำสั่งอิสระ ให้ทำการเรียก `Bash` หลายตัวพร้อมกันในข้อความเดียว Chain ด้วย `&&` เฉพาะเมื่อคำสั่งหนึ่งต้องพึ่งพาอีกคำสั่งหนึ่ง
- Output เกิน 30000 อักขระจะถูกตัด เมื่อจับ log ขนาดใหญ่ ให้ redirect ไปยังไฟล์แล้วอ่านด้วย `Read` tool
- อย่าใช้ interactive flag เช่น `git rebase -i` หรือ `git add -i`; ไม่สามารถรับ input ผ่าน tool นี้ได้
- อย่าข้าม git hook (`--no-verify`, `--no-gpg-sign`) หรือทำการดำเนินการทำลายล้าง (`reset --hard`, `push --force`, `clean -f`) เว้นแต่ผู้ใช้จะขอโดยชัดเจน
