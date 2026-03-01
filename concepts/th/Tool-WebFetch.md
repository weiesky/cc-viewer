# WebFetch

## คำจำกัดความ

ดึงเนื้อหาเว็บเพจจาก URL ที่ระบุ แปลง HTML เป็น markdown และประมวลผลเนื้อหาด้วยโมเดล AI ตาม prompt

## พารามิเตอร์

| พารามิเตอร์ | ประเภท | จำเป็น | คำอธิบาย |
|------|------|------|------|
| `url` | string (URI) | ใช่ | URL แบบเต็มที่จะดึงข้อมูล |
| `prompt` | string | ใช่ | อธิบายว่าต้องการสกัดข้อมูลอะไรจากหน้าเว็บ |

## สถานการณ์การใช้งาน

**เหมาะสำหรับ:**
- ดึงเนื้อหาจากเว็บเพจสาธารณะ
- ดูเอกสารออนไลน์
- สกัดข้อมูลเฉพาะจากเว็บเพจ

**ไม่เหมาะสำหรับ:**
- URL ที่ต้องการการยืนยันตัวตน (Google Docs, Confluence, Jira, GitHub ฯลฯ) — ควรค้นหาเครื่องมือ MCP เฉพาะทางก่อน
- URL ของ GitHub — ควรใช้ CLI `gh` แทน

## ข้อควรระวัง

- URL ต้องเป็น URL ที่ถูกต้องแบบเต็ม
- HTTP จะถูกอัปเกรดเป็น HTTPS โดยอัตโนมัติ
- ผลลัพธ์อาจถูกสรุปเมื่อเนื้อหามีขนาดใหญ่เกินไป
- มีแคชที่ทำความสะอาดตัวเองทุก 15 นาที
- เมื่อ URL เปลี่ยนเส้นทางไปยังโฮสต์อื่น เครื่องมือจะส่งคืน URL เปลี่ยนเส้นทาง ต้องร้องขอใหม่ด้วย URL ใหม่
- หากมีเครื่องมือ web fetch จาก MCP ที่ใช้ได้ ให้ใช้เครื่องมือนั้นแทน

## ความสำคัญใน cc-viewer

การเรียก WebFetch ปรากฏในบันทึกคำร้องขอเป็นคู่ content block `tool_use` / `tool_result` โดย `tool_result` มีสรุปเนื้อหาเว็บเพจที่ประมวลผลโดย AI

## ข้อความต้นฉบับ

<textarea readonly>IMPORTANT: WebFetch WILL FAIL for authenticated or private URLs. Before using this tool, check if the URL points to an authenticated service (e.g. Google Docs, Confluence, Jira, GitHub). If so, you MUST use ToolSearch first to find a specialized tool that provides authenticated access.

- Fetches content from a specified URL and processes it using an AI model
- Takes a URL and a prompt as input
- Fetches the URL content, converts HTML to markdown
- Processes the content with the prompt using a small, fast model
- Returns the model's response about the content
- Use this tool when you need to retrieve and analyze web content

Usage notes:
  - IMPORTANT: If an MCP-provided web fetch tool is available, prefer using that tool instead of this one, as it may have fewer restrictions.
  - The URL must be a fully-formed valid URL
  - HTTP URLs will be automatically upgraded to HTTPS
  - The prompt should describe what information you want to extract from the page
  - This tool is read-only and does not modify any files
  - Results may be summarized if the content is very large
  - Includes a self-cleaning 15-minute cache for faster responses when repeatedly accessing the same URL
  - When a URL redirects to a different host, the tool will inform you and provide the redirect URL in a special format. You should then make a new WebFetch request with the redirect URL to fetch the content.
  - For GitHub URLs, prefer using the gh CLI via Bash instead (e.g., gh pr view, gh issue view, gh api).
</textarea>
