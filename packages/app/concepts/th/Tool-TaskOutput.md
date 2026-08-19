# TaskOutput

ดึง output ที่สะสมของ task เบื้องหลังที่กำลังรันหรือเสร็จสิ้น — คำสั่ง shell เบื้องหลัง, agent ในเครื่อง, หรือ session ระยะไกล ใช้เมื่อต้องการตรวจสอบสิ่งที่ task ที่รันนานได้ผลิตจนถึงขณะนี้

## เมื่อใดควรใช้

- Session ระยะไกล (เช่น cloud sandbox) กำลังรันและคุณต้องการ stdout ของมัน
- Agent ในเครื่องถูก dispatch ใน background และคุณต้องการความคืบหน้าบางส่วนก่อนที่มันจะส่งกลับ
- คำสั่ง shell เบื้องหลังรันนานพอที่คุณต้องการตรวจสอบโดยไม่หยุดมัน
- คุณต้องยืนยันว่า task เบื้องหลังกำลังมีความคืบหน้าจริงๆ ก่อนรอนานขึ้นหรือเรียก `TaskStop`

อย่าหันไปใช้ `TaskOutput` โดยอัตโนมัติ สำหรับงานเบื้องหลังส่วนใหญ่มีเส้นทางที่ตรงกว่า — ดูหมายเหตุด้านล่าง

## พารามิเตอร์

- `task_id` (string, required): ตัวระบุ task ที่ส่งคืนเมื่องานเบื้องหลังเริ่มต้น ไม่ใช่เหมือน `taskId` ของ task-list; นี่คือ handle runtime สำหรับการ execute เฉพาะ
- `block` (boolean, optional): เมื่อ `true` (ค่าเริ่มต้น) รอจนกว่า task จะสร้าง output ใหม่หรือเสร็จก่อนส่งกลับ เมื่อ `false` ส่งกลับทันทีด้วยสิ่งที่ buffer ไว้
- `timeout` (number, optional): millisecond สูงสุดที่ block ก่อนส่งกลับ มีความหมายเฉพาะเมื่อ `block` เป็น `true` ค่าเริ่มต้น `30000`, สูงสุด `600000`

## ตัวอย่าง

### ตัวอย่างที่ 1

ดู session ระยะไกลโดยไม่ block

```
TaskOutput(task_id: "sess_01HXYZ...", block: false)
```

ส่งคืน stdout/stderr ที่ผลิตตั้งแต่ task เริ่ม (หรือตั้งแต่การเรียก `TaskOutput` ครั้งก่อน ขึ้นกับ runtime)

### ตัวอย่างที่ 2

รอสั้นๆ ให้ agent ในเครื่อง emit output เพิ่ม

```
TaskOutput(
  task_id: "agent_01ABCD...",
  block: true,
  timeout: 10000
)
```

## หมายเหตุ

- คำสั่ง bash เบื้องหลัง: `TaskOutput` ถือเป็น deprecated ในการใช้งานนี้ เมื่อคุณเริ่ม task shell เบื้องหลัง ผลลัพธ์จะรวม path ไปยังไฟล์ output ของมันแล้ว — อ่าน path นั้นโดยตรงด้วย tool `Read` `Read` ให้การเข้าถึงแบบสุ่ม offset บรรทัด และมุมมองที่เสถียร; `TaskOutput` ไม่ให้
- Agent ในเครื่อง (tool `Agent` ที่ dispatch ใน background): เมื่อ agent เสร็จ ผลลัพธ์ของ tool `Agent` จะมีการตอบสุดท้ายแล้ว ใช้สิ่งนั้นโดยตรง อย่า `Read` ไฟล์ transcript ที่ symlink — มันมี tool-call stream เต็มและจะ overflow context window
- Session ระยะไกล: `TaskOutput` คือวิธีที่ถูกต้องและมักเป็นวิธีเดียวในการ stream output กลับ ชอบ `block: true` ด้วย `timeout` ที่พอเหมาะมากกว่าการ poll loop ที่แน่น
- `task_id` ที่ไม่รู้จักหรือ task ที่ output ถูก garbage-collect จะคืน error Re-dispatch งานหากยังต้องการ
- `TaskOutput` ไม่หยุด task ใช้ `TaskStop` เพื่อ terminate
