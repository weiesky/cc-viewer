# Custom UltraPlan Expert — คู่มือการเขียน

## สองช่องป้อนข้อมูลทำหน้าที่อะไร

- **ชื่อผู้เชี่ยวชาญ (Expert name)**: ป้ายที่แสดงบนปุ่มบทบาทในแถวตัวเลือก UltraPlan (สูงสุด 30 อักขระ) เป็นเพียงชื่อสำหรับแสดงผลและจะ**ไม่**ถูกส่งไปยัง Claude Code
- **เนื้อหา prompt (Prompt body)**: คำสั่งบทบาทของคุณ เมื่อสร้างผู้เชี่ยวชาญใหม่ ช่องแก้ไขจะ**ถูกเติมไว้ล่วงหน้า**ด้วยตัวห่อหุ้ม `<system-reminder>...</system-reminder>` พร้อมส่วนหัวขอบเขต `[SCOPED INSTRUCTION]` — **เขียนคำสั่งบทบาทของคุณไว้ภายในตัวห่อหุ้ม** cc-viewer จะไม่ห่อหุ้มซ้ำ: ถ้ามีตัวห่อหุ้มอยู่แล้วจะส่งตามเดิม; ถ้าคุณลบออก cc-viewer จะเพิ่มกลับให้ขณะส่ง

---

## เทมเพลตผู้เชี่ยวชาญหน้าตาเป็นอย่างไร?

ผู้เชี่ยวชาญในตัวทุกตัว (Code Expert / Research Expert) เป็นบล็อก `<system-reminder>` ที่ฉีดเข้าไปในบริบทของ Claude Code โดยพื้นฐาน ผู้เชี่ยวชาญที่กำหนดเองของคุณก็ผ่าน pipeline เดียวกันทุกประการ นี่คือการแยกส่วนเทมเพลต **Research Expert**:

```xml
<system-reminder>
[SCOPED INSTRUCTION] The following instructions are intended for the next 1–3
interactions. Once the task is complete, these instructions should be gradually
deprioritized and no longer influence subsequent interactions.

Pre-requisite: Use `AskUserQuestion` to clarify the research scope, target
audience, and deliverable format whenever the user's intent is ambiguous. Skip
only if the intent is unambiguous.

Leverage a multi-agent exploration mechanism to formulate an exceptionally
detailed implementation plan.

Instructions:
1. Utilize the Agent tool to spawn parallel agents that simultaneously explore
   various facets of the requirements:
   - If necessary, deploy a preliminary investigator to conduct an initial
     survey of industry-specific solutions using `webSearch`;
   - If necessary, deploy a specialized investigator to research authoritative
     sources—such as academic papers, news articles, and research reports—
     using `webSearch`;
   - Assign an agent to synthesize the target solution, while simultaneously
     verifying the rigor and credibility of the gathered papers, news, and
     research reports;
   - If necessary, assign an agent to analyze competitor data to provide
     supplementary analytical perspectives;
   - If necessary, assign an agent to handle the implementation of a product
     demo (generating outputs such as HTML, Markdown, etc.);
   - If the task is sufficiently complex, you may assign additional teammates
     to the roles defined above, or introduce other specialized roles; you are
     permitted to schedule up to 5 teammates concurrently.

2. Synthesize the findings from the aforementioned agents into a comprehensive,
   step-by-step implementation plan.

3. Utilize the Agent tool to spawn a set of parallel review agents; these
   agents shall scrutinize the plan from multiple roles and perspectives to
   identify any omitted steps and to propose reasonable additions or
   optimizations.

4. Consolidate the feedback received from the review agents, then invoke
   `ExitPlanMode` to submit your final plan.

5. Upon receiving the result from `ExitPlanMode`:
   - If Approved: Proceed to execute the plan within this current session.
   - If Rejected: Revise the plan based on the provided feedback, and then
     invoke `ExitPlanMode` once again.
   - If an Error Occurs: Do *not* follow the suggestions; prompt the user for
     further instructions.

Your final plan must include the following elements:
- A clear summary of the proposed implementation strategy;
- An ordered list of files to be created or modified, specifying the exact
  changes required for each;
- A step-by-step sequence for executing the implementation;
- Identification of potential risks and corresponding mitigation strategies;
- Creative ideation and suggestions for advanced enhancements;
- If a product demo was generated, place the corresponding demo output in an
  appropriate location and notify the user.
</system-reminder>
```

---

## การวิเคราะห์ทีละส่วน

### 1. ส่วนหัวขอบเขต `[SCOPED INSTRUCTION]` (ตัวห่อหุ้ม — เติมไว้ล่วงหน้าให้คุณ)
> The following instructions are intended for the next 1–3 interactions...

นี่บอก Claude Code ว่า: **คำสั่งเหล่านี้ใช้งานได้เฉพาะในการสนทนา 1–3 รอบถัดไป**เท่านั้น จากนั้นจะค่อยๆ จางหาย ป้องกันไม่ให้ "บุคลิกผู้เชี่ยวชาญ" รั่วไหลเข้าสู่บทสนทนาที่ไม่เกี่ยวข้องในภายหลัง

**บรรทัดนี้ถูกเติมไว้ล่วงหน้าในช่องแก้ไขแล้ว — คงไว้ตามเดิม คุณไม่จำเป็นต้องเขียนใหม่**

### 2. คำจำกัดความงานเริ่มต้น (**นี่คือสิ่งที่คุณควรเขียนใหม่**)
> Leverage a multi-agent exploration mechanism to formulate an exceptionally detailed implementation plan.

นี่คือ "ประธาน-กริยา-กรรม" ของเทมเพลตทั้งหมด: **บอก Claude Code ถึงท่าทีและเป้าหมาย** ค่าเริ่มต้น "การสำรวจหลายเอเจนต์ + แผนการนำไปใช้" เหมาะกับงานด้าน**วิศวกรรมซอฟต์แวร์ / การวางแผน**ดี แต่ดูแปลกสำหรับโดเมนอื่นๆ จำนวนมาก (การตรวจทานเนื้อหา การวิเคราะห์ข้อมูล การเขียนคำโฆษณา การวิจัยตลาด การตรวจสอบการปฏิบัติตามข้อกำหนด...)

**เราขอแนะนำอย่างยิ่งให้เขียนบรรทัดนี้ใหม่ตามวัตถุประสงค์ของคุณ** เช่น:

- **ผู้ตรวจทานเนื้อหา**: "You are a senior content reviewer specializing in {domain}. Your goal is to identify factual inaccuracies, tone inconsistencies, and structural weaknesses in the provided material."
- **นักวิเคราะห์การแข่งขัน**: "Conduct a rigorous competitive analysis for {product category}. Produce a comparison matrix, positioning insights, and strategic recommendations."
- **นักเขียนคำโฆษณา**: "Generate multiple creative copy variants for {scenario}, each with distinct positioning, tone, and call-to-action strategy."

### 3. ขั้นตอนกระบวนการทำงาน (1–5 รายการ — **ตัดทอนหรือขยายตามความซับซ้อน**)

Research Expert มี 5 ขั้นตอน: **สำรวจ → สังเคราะห์ → ตรวจทาน → ส่งแผน → ดำเนินการ** ซึ่งบังคับใช้ "หลายเอเจนต์ขนาน + การตรวจทานข้าม + การอนุมัติแผน" — ความเข้มงวดสามชั้น เหมาะสำหรับงานที่มีเดิมพันสูง/ขอบเขตกว้าง แต่**มากเกินไปสำหรับงานเบาๆ**

- **งานง่าย** (การค้นหาเดี่ยว / แก้ไขเล็กน้อย): ตัดการกระจายงานหลายเอเจนต์และการตรวจทานออก เพียง "ผลิตคำตอบ" ในขั้นตอนเดียว
- **งานปานกลาง**: เก็บ "สำรวจ → สังเคราะห์ → ตรวจทาน" ไว้ ตัดการเต้น ExitPlanMode ออก ส่งมอบผลโดยตรง
- **งานซับซ้อนต้นทุนสูง** (การ refactor ขนาดใหญ่ การเปรียบเทียบหลายตัวเลือก การวิจัยข้ามโดเมน): เก็บทั้ง 5 ขั้นตอน อาจเพิ่มขั้นตอน "โมเดลความเสี่ยง" หรือ "เมทริกซ์เปรียบเทียบตัวเลือก"

### 4. บทบาทย่อยในขั้นตอนที่ 1 (**ปรับแต่งตามโดเมนของคุณ**)

Research Expert ระบุ 6 บทบาทที่เป็นไปได้ (ผู้สำรวจอุตสาหกรรม นักวิจัยวิชาการ ผู้สังเคราะห์ + ผู้ตรวจสอบข้อเท็จจริง นักวิเคราะห์คู่แข่ง ผู้สร้าง demo ช่องสำหรับขยาย) **เขียนรายการนี้ใหม่ตามสถานการณ์ของคุณ**:

- **การเขียน**: "source collector + style analyst + fact checker"
- **การวิเคราะห์ข้อมูล**: "data-cleaning agent + statistical modeling agent + visualization agent"
- **การตรวจสอบโค้ด**: "static-analysis agent + dependency-chain auditor + threat modeler"

### 5. รายการตรวจสอบผลลัพธ์ขั้นสุดท้าย (**สอดคล้องกับความต้องการจริงของคุณ**)

> Your final plan must include the following elements: ...

เทมเพลตเดิมระบุ 6 องค์ประกอบของ "แผนการนำไปใช้" ผลลัพธ์ของคุณอาจเป็นสิ่งอื่นที่แตกต่างไปโดยสิ้นเชิง:

- **รายงานวิจัย** → "Executive summary / Methodology / Key findings / Limitations / Action recommendations"
- **รายงานการตรวจทาน** → "Issue list / Severity rating / Fix suggestions / Before-after examples"
- **เมทริกซ์เปรียบเทียบ** → "Dimension definitions / Scoring rubric / Conclusions / Recommendation rationale"

---

## เคล็ดลับการเขียน (TL;DR)

1. **เขียนประโยคเปิดใหม่**: ระบุบทบาท เป้าหมาย และรูปแบบผลลัพธ์ในบรรทัดเดียว
2. **ปรับเปลี่ยนกระบวนการทำงาน**: 1–2 ขั้นตอนสำหรับงานเบาๆ ใช้วงรอบ 5 ขั้นตอนเต็มเฉพาะงานซับซ้อนเท่านั้น
3. **เขียนบทบาทย่อยในขั้นตอนที่ 1 ใหม่**: ค่าเริ่มต้น (เอกสารวิชาการ / คู่แข่ง / demo) อาจไม่ใช่สิ่งที่คุณต้องการ
4. **"รายการตรวจสอบผลลัพธ์" สุดท้ายคือมาตรฐานคุณภาพของคุณ**: ระบุโครงสร้างผลลัพธ์ออกมา — Claude Code จะปฏิบัติตามอย่างเคร่งครัด

---

## ตัวอย่างที่ปรับโครงสร้างใหม่: Competitive Analyst

```
<system-reminder>
[SCOPED INSTRUCTION] The following instructions apply only to the next 1–3 interactions. Once the task is complete, these instructions should gradually decrease in priority and no longer affect subsequent interactions. You should be adept at utilizing tools such as `AskUserQuestion`, `EnterPlanMode`, and `TeamCreate`, rather than relying solely on plain text processing.

You are a senior competitive intelligence analyst for {industry}. Your goal is to
produce a decision-grade competitive landscape report for the product "{our product}".

Instructions:
1. Use the Agent tool to dispatch 3 parallel investigators:
   - Market landscape agent: map the top 5–8 competitors with core positioning
   - Feature matrix agent: compile a feature-by-feature comparison using
     publicly available sources (webSearch)
   - Pricing & GTM agent: analyze pricing models, distribution channels, and
     go-to-market motions

2. Synthesize the three streams into a unified competitive report.

3. Dispatch one review agent to stress-test the report: challenge any
   assumption lacking a cited source, flag outdated data (>12 months), and
   propose one "non-obvious" insight.

4. Deliver the final report with the following sections:
   - TL;DR (3 bullets)
   - Competitor positioning map
   - Feature matrix (markdown table)
   - Pricing & GTM table
   - Top 3 strategic implications for our product
   - Caveats & data gaps
</system-reminder>
```

เทียบกับ Research Expert ดั้งเดิม: ตัดเหลือ 4 ขั้นตอน บทบาทย่อยลดจาก 6 เหลือ 3 รายการผลลัพธ์ถูกเขียนใหม่ทั้งหมดเป็น "ส่วนของรายงาน"
