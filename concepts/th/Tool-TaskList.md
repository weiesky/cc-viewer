# TaskList

ส่งคืนทุก task ในทีมปัจจุบัน (หรือ session) ในรูป summary ใช้เพื่อสำรวจงานที่ค้างอยู่ ตัดสินใจว่าจะรับอะไรต่อไป และหลีกเลี่ยงการสร้างสิ่งซ้ำ

## เมื่อใดควรใช้

- เมื่อเริ่ม session เพื่อดูว่าอะไรถูกติดตามไว้แล้ว
- ก่อนเรียก `TaskCreate` เพื่อยืนยันว่างานยังไม่ถูกจับ
- เมื่อตัดสินใจว่าจะอ้างสิทธิ์ task อะไรต่อไปเป็น teammate หรือ subagent
- เพื่อตรวจสอบความสัมพันธ์ dependency ข้ามทีมในพริบตา
- เป็นระยะระหว่าง session ที่ยาว เพื่อ re-sync กับ teammate ที่อาจอ้าง เสร็จ หรือเพิ่ม task

`TaskList` เป็น read-only และถูก; เรียกได้อย่างอิสระเมื่อต้องการ overview

## การเปิดใช้งาน

- พร้อมใช้งานตามค่าเริ่มต้นในโมเดลส่วนใหญ่
- ไม่พร้อมใช้งานในตระกูล Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 และใหม่กว่า (v2.1.233+) เว้นแต่เปิดใช้งานผ่าน `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools`, หรือ `--tools`
- ระบบ task ทั้งหมดถูกปิดใช้งานเมื่อ `CLAUDE_CODE_ENABLE_TASKS=false`

## พารามิเตอร์

`TaskList` ไม่รับ parameter มันส่งคืนชุด task เต็มสำหรับ context ที่ active เสมอ

## รูปร่างการตอบกลับ

แต่ละ task ใน list เป็น summary ไม่ใช่บันทึกเต็ม คาดว่า:

- `id` — ตัวระบุคงที่สำหรับใช้กับ `TaskGet` / `TaskUpdate`
- `subject` — หัวข้อสั้นในรูปคำสั่ง
- `status` — หนึ่งใน `pending`, `in_progress`, `completed`, `deleted`
- `owner` — handle ของ agent หรือ teammate หรือว่างเมื่อไม่ถูกอ้างสิทธิ์
- `blockedBy` — array ของ task ID ที่ต้องเสร็จก่อน

สำหรับ description เต็ม, acceptance criteria, หรือ metadata ของ task เฉพาะ ให้ follow up ด้วย `TaskGet`

## ตัวอย่าง

### ตัวอย่างที่ 1

ตรวจสอบสถานะอย่างเร็ว

```
TaskList()
```

สแกน output หาสิ่งที่เป็น `in_progress` โดยไม่มี `owner` (งานค้าง) และสิ่งที่ `pending` โดยมี `blockedBy` ว่าง (พร้อมรับ)

### ตัวอย่างที่ 2

Teammate เลือก task ถัดไป

```
TaskList()
# Filter ไปยัง: status == pending AND blockedBy ว่าง AND owner ว่าง
# ในบรรดานั้น เลือก ID ที่ต่ำกว่า (task มักถูกหมายเลขตามลำดับ
# การสร้าง ดังนั้น ID ต่ำกว่าเก่ากว่าและมักมีความสำคัญสูงกว่า)
TaskGet(taskId: "<chosen id>")
TaskUpdate(taskId: "<chosen id>", status: "in_progress", owner: "<your handle>")
```

## หมายเหตุ

- Heuristic ของ teammate: เมื่อมีหลาย task ที่ `pending` ถูก unblock และไม่มี owner ให้เลือก ID ต่ำที่สุด สิ่งนี้รักษางานเป็น FIFO และหลีกเลี่ยง agent สองตัวคว้า task ที่โดดเด่นเดียวกัน
- เคารพ `blockedBy`: อย่าเริ่ม task ที่ blocker ของมันยัง `pending` หรือ `in_progress` ทำงาน blocker ก่อนหรือประสานกับ owner ของมัน
- `TaskList` เป็นกลไกการค้นพบเพียงอย่างเดียวสำหรับ task ไม่มีการค้นหา; หาก list ยาวให้สแกนตามโครงสร้าง (ตามสถานะ แล้วตาม owner)
- Task ที่ลบแล้วอาจยังปรากฏใน list ด้วยสถานะ `deleted` เพื่อการติดตามกลับ ละเลยสำหรับการวางแผน
- List สะท้อนสถานะสดของทีม ดังนั้น teammate อาจเพิ่มหรืออ้างสิทธิ์ task ระหว่างการเรียก List ใหม่ก่อนอ้างสิทธิ์หากเวลาผ่านไป
