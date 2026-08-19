# AskUserQuestion

แสดงคำถามแบบเลือกตอบหลายตัวเลือกที่มีโครงสร้างหนึ่งคำถามหรือมากกว่าให้ผู้ใช้ใน chat UI รวบรวมตัวเลือกของพวกเขา และส่งกลับไปให้ผู้ช่วย — มีประโยชน์สำหรับการคลายความกำกวมของเจตนาโดยไม่ต้องใช้การโต้ตอบแบบ free-form

## เมื่อใดควรใช้

- คำขอมีการตีความที่สมเหตุสมผลหลายแบบและผู้ช่วยต้องการให้ผู้ใช้เลือกก่อนดำเนินการ
- ผู้ใช้ต้องเลือกจากตัวเลือกที่เป็นรูปธรรม (framework, library, file path, strategy) ซึ่งการตอบแบบ free-text จะเสี่ยงต่อข้อผิดพลาด
- คุณต้องการเปรียบเทียบทางเลือกข้างเคียงกันโดยใช้ panel preview
- การตัดสินใจที่เกี่ยวข้องหลายเรื่องสามารถรวมใน prompt เดียวเพื่อลดการโต้ตอบไปมา
- แผนหรือ tool call ขึ้นอยู่กับ configuration ที่ผู้ใช้ยังไม่ได้ระบุ

## พารามิเตอร์

- `questions` (array, required): คำถามหนึ่งถึงสี่ข้อที่แสดงร่วมกันใน prompt เดียว แต่ละ object คำถามประกอบด้วย:
  - `question` (string, required): ข้อความคำถามเต็ม ลงท้ายด้วยเครื่องหมายคำถาม
  - `header` (string, required): ป้ายสั้น (ไม่เกิน 12 อักขระ) แสดงเป็น chip เหนือคำถาม
  - `options` (array, required): Option object สองถึงสี่ตัว แต่ละ option มี `label` (1–5 คำ), `description`, และ `markdown` preview แบบ optional
  - `multiSelect` (boolean, required): เมื่อ `true` ผู้ใช้สามารถเลือกได้มากกว่าหนึ่งตัวเลือก

## ตัวอย่าง

### ตัวอย่างที่ 1: เลือก framework เดียว

```
AskUserQuestion(questions=[{
  "header": "Test runner",
  "question": "Which test runner should I configure?",
  "multiSelect": false,
  "options": [
    {"label": "Vitest (Recommended)", "description": "Fast, Vite-native, Jest-compatible API"},
    {"label": "Jest",                  "description": "Mature, broadest plugin ecosystem"},
    {"label": "Node --test",           "description": "Zero dependencies, built in"}
  ]
}])
```

### ตัวอย่างที่ 2: Preview สองเลย์เอาต์เคียงข้างกัน

```
AskUserQuestion(questions=[{
  "header": "Layout",
  "question": "Which dashboard layout do you prefer?",
  "multiSelect": false,
  "options": [
    {"label": "Sidebar",  "description": "Nav on the left", "markdown": "```\n+------+---------+\n| NAV  | CONTENT |\n+------+---------+\n```"},
    {"label": "Top bar",  "description": "Nav across top",  "markdown": "```\n+-----------------+\n|       NAV       |\n+-----------------+\n|     CONTENT     |\n+-----------------+\n```"}
  ]
}])
```

## หมายเหตุ

- UI จะเพิ่มตัวเลือก free-text "Other" ต่อท้ายทุกคำถามโดยอัตโนมัติ อย่าเพิ่มรายการ "Other", "None", หรือ "Custom" ของคุณเอง — จะไปซ้ำกับทางออกที่มีในตัว
- จำกัดแต่ละการเรียกระหว่างหนึ่งถึงสี่คำถาม และแต่ละคำถามระหว่างสองถึงสี่ตัวเลือก การเกินขอบเขตนี้จะถูก harness ปฏิเสธ
- หากคุณแนะนำตัวเลือกเฉพาะ ให้วางไว้อันแรกและเพิ่ม "(Recommended)" ต่อท้าย label เพื่อให้ UI ไฮไลต์เส้นทางที่แนะนำ
- Preview ผ่านฟิลด์ `markdown` รองรับเฉพาะคำถามแบบเลือกเดียว ใช้สำหรับ artifact แบบมองเห็นได้ เช่น ASCII layout, code snippet, หรือ configuration diff — ไม่ใช้กับคำถามแบบเลือกความชอบธรรมดาที่ label กับ description ก็เพียงพอ
- เมื่อตัวเลือกใดในคำถามมีค่า `markdown` UI จะสลับเป็นเลย์เอาต์ข้างกัน โดยมีรายการตัวเลือกทางซ้ายและ preview ทางขวา
- อย่าใช้ `AskUserQuestion` เพื่อถามว่า "แผนนี้ดูโอเคไหม?" — ให้เรียก `ExitPlanMode` แทน ซึ่งมีไว้เพื่อการอนุมัติแผนโดยเฉพาะ ในโหมด plan ก็หลีกเลี่ยงการกล่าวถึง "the plan" ในข้อความคำถามด้วย เพราะแผนยังไม่ปรากฏต่อผู้ใช้จนกว่า `ExitPlanMode` จะรัน
- อย่าใช้ tool นี้เพื่อขอข้อมูลที่ sensitive หรือ free-form เช่น API key หรือรหัสผ่าน ให้ถามใน chat แทน
