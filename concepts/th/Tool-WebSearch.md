# WebSearch

## คำจำกัดความ

ค้นหาผ่านเครื่องมือค้นหา ส่งคืนผลลัพธ์การค้นหาเพื่อรับข้อมูลล่าสุด

## พารามิเตอร์

| พารามิเตอร์ | ประเภท | จำเป็น | คำอธิบาย |
|------|------|------|------|
| `query` | string | ใช่ | คำค้นหา (อย่างน้อย 2 ตัวอักษร) |
| `allowed_domains` | string[] | ไม่ | รวมเฉพาะผลลัพธ์จากโดเมนเหล่านี้ |
| `blocked_domains` | string[] | ไม่ | ไม่รวมผลลัพธ์จากโดเมนเหล่านี้ |

## สถานการณ์การใช้งาน

**เหมาะสำหรับ:**
- รับข้อมูลล่าสุดที่เกินวันตัดความรู้ของโมเดล
- ค้นหาเหตุการณ์ปัจจุบันและข้อมูลล่าสุด
- ค้นหาเอกสารทางเทคนิคล่าสุด

## ข้อควรระวัง

- ผลลัพธ์การค้นหาส่งคืนในรูปแบบไฮเปอร์ลิงก์ markdown
- หลังจากใช้ ต้องแนบส่วน "Sources:" ที่ท้ายคำตอบ โดยแสดงรายการ URL ที่เกี่ยวข้อง
- รองรับการกรองโดเมน (รวม/ไม่รวม)
- คำค้นหาควรใช้ปีปัจจุบัน
- ใช้ได้เฉพาะในสหรัฐอเมริกา

## ความสำคัญใน cc-viewer

การเรียก WebSearch ปรากฏในบันทึกคำร้องขอเป็นคู่ content block `tool_use` / `tool_result` โดย `tool_result` มีรายการผลลัพธ์การค้นหา

## ข้อความต้นฉบับ

<textarea readonly>
- Allows Claude to search the web and use the results to inform responses
- Provides up-to-date information for current events and recent data
- Returns search result information formatted as search result blocks, including links as markdown hyperlinks
- Use this tool for accessing information beyond Claude's knowledge cutoff
- Searches are performed automatically within a single API call

CRITICAL REQUIREMENT - You MUST follow this:
  - After answering the user's question, you MUST include a "Sources:" section at the end of your response
  - In the Sources section, list all relevant URLs from the search results as markdown hyperlinks: [Title](URL)
  - This is MANDATORY - never skip including sources in your response
  - Example format:

    [Your answer here]

    Sources:
    - [Source Title 1](https://example.com/1)
    - [Source Title 2](https://example.com/2)

Usage notes:
  - Domain filtering is supported to include or block specific websites
  - Web search is only available in the US

IMPORTANT - Use the correct year in search queries:
  - The current month is March 2026. You MUST use this year when searching for recent information, documentation, or current events.
  - Example: If the user asks for "latest React docs", search for "React documentation" with the current year, NOT last year
</textarea>
