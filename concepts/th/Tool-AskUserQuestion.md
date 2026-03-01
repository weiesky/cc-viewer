# AskUserQuestion

## คำจำกัดความ

ถามคำถามผู้ใช้ระหว่างการดำเนินงาน เพื่อขอคำชี้แจง ตรวจสอบสมมติฐาน หรือขอการตัดสินใจ

## พารามิเตอร์

| พารามิเตอร์ | ประเภท | จำเป็น | คำอธิบาย |
|------|------|------|------|
| `questions` | array | ใช่ | รายการคำถาม (1-4 คำถาม) |
| `answers` | object | ไม่ | คำตอบที่รวบรวมจากผู้ใช้ |
| `annotations` | object | ไม่ | หมายเหตุสำหรับแต่ละคำถาม (เช่น บันทึกการแสดงตัวอย่างตัวเลือก) |
| `metadata` | object | ไม่ | ข้อมูลเมตาสำหรับการติดตามและวิเคราะห์ |

แต่ละอ็อบเจกต์ `question`:

| ฟิลด์ | ประเภท | จำเป็น | คำอธิบาย |
|------|------|------|------|
| `question` | string | ใช่ | ข้อความคำถามแบบเต็ม ควรลงท้ายด้วยเครื่องหมายคำถาม |
| `header` | string | ใช่ | ป้ายกำกับสั้น (สูงสุด 12 ตัวอักษร) แสดงเป็นชิปแท็ก |
| `options` | array | ใช่ | 2-4 ตัวเลือก |
| `multiSelect` | boolean | ใช่ | อนุญาตให้เลือกหลายรายการหรือไม่ |

แต่ละอ็อบเจกต์ `option`:

| ฟิลด์ | ประเภท | จำเป็น | คำอธิบาย |
|------|------|------|------|
| `label` | string | ใช่ | ข้อความแสดงตัวเลือก (1-5 คำ) |
| `description` | string | ใช่ | คำอธิบายตัวเลือก |
| `markdown` | string | ไม่ | เนื้อหาแสดงตัวอย่าง (สำหรับการเปรียบเทียบภาพของเลย์เอาต์ ASCII, โค้ดสนิปเป็ต ฯลฯ) |

## สถานการณ์การใช้งาน

**เหมาะสำหรับ:**
- รวบรวมความต้องการหรือข้อกำหนดของผู้ใช้
- ชี้แจงคำสั่งที่คลุมเครือ
- รับการตัดสินใจระหว่างการดำเนินงาน
- เสนอทางเลือกทิศทางให้ผู้ใช้

**ไม่เหมาะสำหรับ:**
- ถามว่า "แผนนี้โอเคไหม?" — ควรใช้ ExitPlanMode

## ข้อควรระวัง

- ผู้ใช้สามารถเลือก "Other" เพื่อให้อินพุตที่กำหนดเองได้เสมอ
- ตัวเลือกที่แนะนำควรอยู่ในลำดับแรก โดยเพิ่ม "(Recommended)" ที่ท้าย label
- การแสดงตัวอย่าง `markdown` รองรับเฉพาะคำถามแบบเลือกรายการเดียว
- ตัวเลือกที่มี `markdown` จะสลับเป็นเลย์เอาต์แบบเคียงข้างกัน
- ในโหมดวางแผน ใช้เพื่อชี้แจงข้อกำหนดก่อนกำหนดแผน

## ความสำคัญใน cc-viewer

การเรียก AskUserQuestion ปรากฏในบันทึกคำร้องขอเป็น content block `tool_use` ซึ่งมีคำจำกัดความของคำถามและตัวเลือก คำตอบของผู้ใช้จะปรากฏในประวัติข้อความของคำร้องขอถัดไป

## ข้อความต้นฉบับ

<textarea readonly>Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- Users will always be able to select "Other" to provide custom text input
- Use multiSelect: true to allow multiple answers to be selected for a question
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label

Plan mode note: In plan mode, use this tool to clarify requirements or choose between approaches BEFORE finalizing your plan. Do NOT use this tool to ask "Is my plan ready?" or "Should I proceed?" - use ExitPlanMode for plan approval. IMPORTANT: Do not reference "the plan" in your questions (e.g., "Do you have feedback about the plan?", "Does the plan look good?") because the user cannot see the plan in the UI until you call ExitPlanMode. If you need plan approval, use ExitPlanMode instead.

Preview feature:
Use the optional `markdown` field on options when presenting concrete artifacts that users need to visually compare:
- ASCII mockups of UI layouts or components
- Code snippets showing different implementations
- Diagram variations
- Configuration examples

When any option has a markdown, the UI switches to a side-by-side layout with a vertical option list on the left and preview on the right. Do not use previews for simple preference questions where labels and descriptions suffice. Note: previews are only supported for single-select questions (not multiSelect).
</textarea>
