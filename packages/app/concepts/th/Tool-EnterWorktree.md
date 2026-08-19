# EnterWorktree

สร้าง Git worktree ที่แยกต่างหากบน branch ใหม่ หรือสลับ session เข้าไปใน worktree ที่มีอยู่แล้วของ repository ปัจจุบัน เพื่อให้งานแบบขนานหรือทดลองดำเนินการได้โดยไม่แตะ checkout หลัก

## เมื่อใดควรใช้

- ผู้ใช้บอกชัดเจนว่า "worktree" — เช่น "start a worktree", "create a worktree", หรือ "work in a worktree"
- คำสั่งโปรเจกต์ใน `CLAUDE.md` หรือ persistent memory สั่งให้ใช้ worktree สำหรับงานปัจจุบัน
- คุณต้องการทำงานต่อที่เคยตั้งค่าไว้เป็น worktree ก่อนหน้า (ส่ง `path` เพื่อเข้าอีกครั้ง)
- Branch ทดลองหลายตัวต้องอยู่ร่วมกันบน disk โดยไม่ต้อง checkout เปลี่ยนไปมา
- งานที่รันนานควรแยกออกจากการแก้ไขที่ไม่เกี่ยวข้องใน working tree หลัก

## พารามิเตอร์

- `name` (string, optional): ชื่อสำหรับ directory worktree ใหม่ แต่ละ segment ที่คั่นด้วย `/` ต้องมีเฉพาะตัวอักษร ตัวเลข จุด underscore และ dash; string เต็มจำกัดที่ 64 อักขระ หากละเว้นและ `path` ก็ละเว้นด้วย จะสร้างชื่อสุ่ม ใช้ร่วมกับ `path` ไม่ได้
- `path` (string, optional): filesystem path ของ worktree ที่มีอยู่แล้วของ repository ปัจจุบันที่จะสลับเข้าไป ต้องปรากฏใน `git worktree list` สำหรับ repo นี้; path ที่ไม่ใช่ worktree ที่ลงทะเบียนของ repo ปัจจุบันจะถูกปฏิเสธ ใช้ร่วมกับ `name` ไม่ได้

## ตัวอย่าง

### ตัวอย่างที่ 1: สร้าง worktree ใหม่ด้วยชื่อที่บรรยาย

```
EnterWorktree(name="feat/okta-sso")
```

สร้าง `.claude/worktrees/feat/okta-sso` บน branch ใหม่ตาม `HEAD` แล้วสลับ working directory ของ session เข้าไป การแก้ไขไฟล์และ shell command ทั้งหมดต่อจากนี้จะทำภายใน worktree นั้นจนกว่าคุณจะออก

### ตัวอย่างที่ 2: เข้า worktree ที่มีอยู่แล้วอีกครั้ง

```
EnterWorktree(path="/Users/me/repo/.claude/worktrees/feat/okta-sso")
```

ทำงานต่อใน worktree ที่สร้างไว้ก่อนหน้า เพราะคุณเข้าผ่าน `path`, `ExitWorktree` จะไม่ลบมันโดยอัตโนมัติ — ออกด้วย `action: "keep"` จะแค่กลับไปยัง directory เดิม

## หมายเหตุ

- อย่าเรียก `EnterWorktree` เว้นแต่ผู้ใช้ขอชัดเจนหรือคำสั่งโปรเจกต์กำหนด คำขอสลับ branch หรือแก้บั๊กทั่วไปควรใช้คำสั่ง Git ปกติ ไม่ใช่ worktree
- เมื่อเรียกภายใน Git repository, tool จะสร้าง worktree ใต้ `.claude/worktrees/` และลงทะเบียน branch ใหม่ตาม `HEAD` ภายนอก Git repository มันจะ delegate ไปยัง `WorktreeCreate` / `WorktreeRemove` hook ที่ตั้งไว้ใน `settings.json` สำหรับการแยกที่ไม่ขึ้นกับ VCS
- มีเพียง worktree session เดียวที่ active ณ เวลาใดเวลาหนึ่ง Tool ปฏิเสธที่จะรันหากคุณอยู่ใน worktree session อยู่แล้ว ออกก่อนด้วย `ExitWorktree`
- ใช้ `ExitWorktree` เพื่อออกกลางคัน หาก session จบในขณะที่ยังอยู่ใน worktree ที่เพิ่งสร้าง ผู้ใช้จะได้รับ prompt ให้เลือกเก็บหรือลบ
- Worktree ที่เข้าโดย `path` ถือเป็น external — `ExitWorktree` ด้วย `action: "remove"` จะไม่ลบมัน นี่คือ safety rail ในการปกป้อง worktree ที่ผู้ใช้จัดการเอง
- Worktree ใหม่สืบทอดเนื้อหาของ branch ปัจจุบันแต่มี working directory และ index อิสระ การเปลี่ยนแปลงที่ staged และ unstaged ใน checkout หลักไม่ visible ภายใน worktree
- เคล็ดการตั้งชื่อ: ใส่ prefix ตามประเภทงาน (`feat/`, `fix/`, `spike/`) เพื่อให้แยก worktree พร้อมกันหลายตัวได้ง่ายใน `git worktree list`
