# EnterPlanMode

สลับ session เข้าสู่ plan mode ซึ่งเป็น phase การสำรวจแบบ read-only ที่ผู้ช่วยจะสำรวจ codebase และร่างแผนการ implement ที่เป็นรูปธรรมเพื่อให้ผู้ใช้อนุมัติก่อนที่จะมีการแก้ไขไฟล์ใดๆ

## เมื่อใดควรใช้

- ผู้ใช้ขอการเปลี่ยนแปลงที่ไม่ธรรมดาซึ่งครอบคลุมหลายไฟล์หรือ subsystem
- ข้อกำหนดคลุมเครือและผู้ช่วยต้องอ่านโค้ดก่อนตัดสินใจเลือก approach
- มีการเสนอ refactor, migration, หรือ dependency upgrade และ blast radius ไม่ชัดเจน
- ผู้ใช้บอกชัดเจนว่า "plan this", "let's plan first", หรือขอ design review
- ความเสี่ยงสูงพอที่การไปแก้ไขทันทีอาจเสียงานหรือทำลาย state

## พารามิเตอร์

ไม่มี `EnterPlanMode` ไม่รับ argument — invoke ด้วย parameter object ว่าง

## ตัวอย่าง

### ตัวอย่างที่ 1: คำขอฟีเจอร์ใหญ่

ผู้ใช้ถาม: "Add SSO via Okta to the admin panel." ผู้ช่วยเรียก `EnterPlanMode` จากนั้นใช้หลาย turn อ่าน auth middleware, session storage, route guard, และ login UI ที่มีอยู่ เขียนแผนอธิบายการเปลี่ยนแปลงที่ต้องทำ ขั้นตอน migration และ test coverage แล้วส่งผ่าน `ExitPlanMode` เพื่อขออนุมัติ

### ตัวอย่างที่ 2: Refactor ที่เสี่ยง

ผู้ใช้บอก: "Convert the REST controllers to tRPC." ผู้ช่วยเข้า plan mode สำรวจแต่ละ controller แคตตาล็อก public contract ระบุ phase การ rollout (shim, dual-read, cutover) และเสนอ plan การ sequence ก่อนแตะไฟล์ใดๆ

## หมายเหตุ

- Plan mode เป็น read-only ตาม contract ขณะอยู่ในโหมดนี้ ผู้ช่วยต้องไม่รัน `Edit`, `Write`, `NotebookEdit`, หรือ shell command ที่แก้ไข state ใดๆ ใช้เฉพาะ `Read`, `Grep`, `Glob`, และคำสั่ง `Bash` ที่ไม่ทำลายเท่านั้น
- อย่าเข้า plan mode สำหรับการแก้ไข one-liner ธรรมดา คำถามวิจัยล้วนๆ หรืองานที่ผู้ใช้ระบุการเปลี่ยนแปลงอย่างละเอียดครบถ้วนแล้ว Overhead เสียมากกว่าได้
- ภายใต้ Auto mode ไม่สนับสนุน plan mode เว้นแต่ผู้ใช้ขอโดยชัดเจน — Auto mode ชอบการลงมือทำมากกว่าการวางแผนล่วงหน้า
- ใช้ plan mode เพื่อลดการแก้ทิศทางในงานที่แพง แผนห้านาทีมักจะประหยัดการแก้ไขที่ผิดทิศทางหนึ่งชั่วโมง
- เมื่ออยู่ใน plan mode แล้ว ให้โฟกัสการสำรวจไปที่ส่วนของระบบที่จะเปลี่ยนจริงๆ หลีกเลี่ยง tour ที่ละเอียดของ repository ที่ไม่เกี่ยวข้องกับงาน
- ตัวแผนเองควรเขียนลง disk ที่ path ที่ harness คาดไว้ เพื่อให้ `ExitPlanMode` สามารถส่งได้ แผนควรมี path ของไฟล์ ชื่อ function และขั้นตอนการตรวจสอบที่เป็นรูปธรรม ไม่ใช่เจตนาที่คลุมเครือ
- ผู้ใช้อาจปฏิเสธแผนและขอการแก้ไข Iterate ภายใน plan mode จนแผนได้รับการยอมรับ แล้วค่อยออก
