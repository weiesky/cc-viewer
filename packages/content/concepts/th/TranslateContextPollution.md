# การปนเปื้อนบริบทใน Translate API

## ความเป็นมา

CC-Viewer มีฟีเจอร์แปลภาษาในตัว (`POST /api/translate`) ที่ขับเคลื่อนโดย Anthropic Messages API ในการพัฒนาช่วงแรก คำขอแปลภาษาใช้ข้อมูลรับรองตัวตนที่แคชไว้จากเซสชัน Claude Code ซ้ำ — รวมถึงทั้ง header `x-api-key` และ `authorization` สิ่งนี้ทำให้เกิดปัญหาที่แนบเนียนแต่ร้ายแรง: ผลลัพธ์การแปลมักส่งคืนเนื้อหาที่ไม่เกี่ยวข้อง

## สาเหตุหลัก

### ความแตกต่างพื้นฐานระหว่างสองวิธีการรับรองตัวตน

Anthropic API รองรับสองวิธีการรับรองตัวตน:

| วิธี | Header | แหล่งที่มาทั่วไป | ลักษณะเฉพาะ |
|------|--------|-------------------|-------------|
| API Key | `x-api-key: sk-ant-...` | ตัวแปรสภาพแวดล้อม / Console | ไม่มีสถานะ แต่ละคำขอเป็นอิสระ |
| OAuth Token | `authorization: Bearer sessionToken` | การเข้าสู่ระบบแบบสมัครสมาชิก Claude Code | ผูกกับเซสชัน เซิร์ฟเวอร์รักษาการเชื่อมโยงบริบท |

ความแตกต่างสำคัญ: **API Key ไม่มีสถานะ** — แต่ละคำขอเป็นอิสระอย่างสมบูรณ์ ในขณะที่ **OAuth session token มีสถานะ** — เซิร์ฟเวอร์ Anthropic เชื่อมโยงคำขอที่ใช้โทเค็นเดียวกันเข้ากับบริบทเซสชันเดียวกัน

### ห่วงโซ่การปนเปื้อน

เมื่อ Claude Code ใช้การเข้าสู่ระบบ OAuth แบบสมัครสมาชิก กระบวนการรับรองตัวตนจะเป็นดังนี้:

```
การสนทนาหลักของ Claude Code ──(authorization: Bearer sessionToken)──→ Anthropic API
                                                                          ↑
คำขอแปลภาษาของ CC-Viewer ──(authorization: Bearer sessionToken)──→ Anthropic API
```

เนื่องจากคำขอแปลภาษาใช้ session token เดียวกันซ้ำ เซิร์ฟเวอร์ Anthropic อาจเชื่อมโยงคำขอแปลภาษาเข้ากับบริบทการสนทนาหลักของ Claude Code ส่งผลให้:

1. **ผลลัพธ์การแปลได้รับอิทธิพลจากบริบทการสนทนาหลัก**: system prompt ของคำขอแปลคือ "คุณคือนักแปล" แต่บริบทของเซิร์ฟเวอร์ยังคงมีประวัติการสนทนาของ Claude Code ซึ่งอาจรบกวนโมเดล
2. **การสนทนาหลักถูกรบกวนจากคำขอแปลภาษา**: เนื้อหาของคำขอแปล (ส่วนข้อความ UI) อาจถูกแทรกเข้าไปในบริบทการสนทนาหลัก ทำให้คำตอบของ Claude Code เบี่ยงเบน
3. **พฤติกรรมที่คาดเดาไม่ได้**: เนื่องจากการปนเปื้อนบริบทเป็นพฤติกรรมฝั่งเซิร์ฟเวอร์ ไคลเอนต์ไม่สามารถตรวจจับหรือควบคุมได้

## บทเรียนที่ได้รับ

- **OAuth session token ไม่ใช่ "แค่ API Key อีกตัว"** — มันมีสถานะฝั่งเซิร์ฟเวอร์ การใช้ซ้ำหมายถึงการแชร์บริบท
- **การเรียกบริการภายในควรใช้การรับรองตัวตนแบบอิสระและไม่มีสถานะ** เพื่อหลีกเลี่ยงการเชื่อมโยงกับเซสชันของผู้ใช้

## อ้างอิง

- [Anthropic API Authentication Docs](https://docs.anthropic.com/en/api/getting-started)
- [Claude Code Authentication](https://support.claude.com/en/articles/12304248-managing-api-key-environment-variables-in-claude-code)
- [Anthropic Bans Subscription OAuth in Third-Party Apps](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/)
- [Claude Code Authentication: API Keys, Subscriptions, and SSO](https://developertoolkit.ai/en/claude-code/quick-start/authentication/)
