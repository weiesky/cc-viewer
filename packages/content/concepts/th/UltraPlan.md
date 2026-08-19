# UltraPlan — เครื่องอธิษฐานสุดยอด

## UltraPlan คืออะไร

UltraPlan คือ**การนำไปใช้งานแบบ localized** ของ cc-viewer สำหรับคำสั่ง `/ultraplan` ดั้งเดิมของ Claude Code ช่วยให้คุณใช้ความสามารถทั้งหมดของ `/ultraplan` ในสภาพแวดล้อมภายในเครื่องของคุณ**โดยไม่จำเป็นต้องเปิดใช้บริการระยะไกลอย่างเป็นทางการของ Claude** นำทาง Claude Code ให้สำเร็จงานวางแผนและดำเนินการที่ซับซ้อนโดยใช้**การทำงานร่วมกันแบบหลายเอเจนต์**

เมื่อเทียบกับโหมด Plan ปกติหรือ Agent Team แล้ว UltraPlan สามารถ:
- นำเสนอบทบาท**ผู้เชี่ยวชาญโค้ด**และ**ผู้เชี่ยวชาญวิจัย**ที่ปรับให้เหมาะกับประเภทงานที่แตกต่างกัน
- ส่งเอเจนต์คู่ขนานหลายตัวเพื่อสำรวจโค้ดเบสหรือทำการวิจัยจากมิติต่าง ๆ
- รวมการค้นคว้าภายนอก (webSearch) เพื่อดูแนวปฏิบัติที่ดีที่สุดในอุตสาหกรรม
- รวบรวมทีม Code Review โดยอัตโนมัติหลังจากดำเนินแผนเสร็จเพื่อตรวจสอบโค้ด
- สร้างวงจรปิดที่สมบูรณ์ **วางแผน → ดำเนินการ → ตรวจสอบ → แก้ไข**

---

## หมายเหตุสำคัญ

### 1. UltraPlan ไม่ใช่สิ่งที่ทำได้ทุกอย่าง
UltraPlan เป็นเครื่องอธิษฐานที่ทรงพลังกว่า แต่นั่นไม่ได้หมายความว่าทุกคำอธิษฐานจะเป็นจริงได้ มันทรงพลังกว่า Plan และ Agent Team แต่ไม่สามารถ "ทำเงินให้คุณ" ได้โดยตรง พิจารณาความละเอียดของงานที่เหมาะสม — แบ่งเป้าหมายใหญ่เป็นงานขนาดกลางที่ดำเนินการได้ แทนที่จะพยายามทำทุกอย่างในครั้งเดียว

### 2. ปัจจุบันมีประสิทธิภาพสูงสุดสำหรับโปรเจกต์โปรแกรมมิ่ง
เทมเพลตและเวิร์กโฟลว์ของ UltraPlan ได้รับการปรับปรุงอย่างลึกซึ้งสำหรับโปรเจกต์โปรแกรมมิ่ง สถานการณ์อื่น ๆ (เอกสาร, การวิเคราะห์ข้อมูล ฯลฯ) สามารถลองได้ แต่คุณอาจต้องรอการปรับปรุงในเวอร์ชันอนาคต

### 3. เวลาดำเนินการและข้อกำหนดหน้าต่างบริบท
- การรัน UltraPlan ที่สำเร็จโดยทั่วไปใช้เวลา **30 นาทีขึ้นไป**
- ต้องการให้ MainAgent มีหน้าต่างบริบทขนาดใหญ่ (แนะนำโมเดล Opus ที่มีบริบท 1M)
- หากคุณมีเพียงโมเดล 200K **ต้องแน่ใจว่าได้ `/clear` บริบทก่อนรัน**
- คำสั่ง `/compact` ของ Claude Code ทำงานได้ไม่ดีเมื่อหน้าต่างบริบทไม่เพียงพอ — หลีกเลี่ยงการใช้พื้นที่จนหมด
- การรักษาพื้นที่บริบทให้เพียงพอเป็นข้อกำหนดเบื้องต้นที่สำคัญสำหรับการดำเนินการ UltraPlan ที่สำเร็จ

หากคุณมีคำถามหรือข้อเสนอแนะเกี่ยวกับ UltraPlan แบบ localized สามารถเปิด [Issues บน GitHub](https://github.com/anthropics/claude-code/issues) เพื่อพูดคุยและร่วมมือกัน

---

## หลักการทำงาน

UltraPlan นำเสนอบทบาทผู้เชี่ยวชาญสองบทบาท สำหรับงานประเภทต่าง ๆ:

### ผู้เชี่ยวชาญโค้ด
เวิร์กโฟลว์การทำงานร่วมกันแบบมัลติเอเจนต์ ออกแบบสำหรับโปรเจกต์การเขียนโปรแกรม:
1. ส่งเอเจนต์คู่ขนานสูงสุด 5 ตัวเพื่อสำรวจโค้ดเบสพร้อมกัน (สถาปัตยกรรม, การระบุไฟล์, การประเมินความเสี่ยง ฯลฯ)
2. ส่งเอเจนต์วิจัยเพื่อศึกษาโซลูชันในอุตสาหกรรมผ่าน webSearch (ตัวเลือก)
3. สังเคราะห์ข้อค้นพบทั้งหมดเป็นแผนการดำเนินงานโดยละเอียด
4. ส่งเอเจนต์ตรวจสอบเพื่อพิจารณาแผนจากหลายมุมมอง
5. ดำเนินการตามแผนเมื่อได้รับอนุมัติ
6. จัดตั้ง Code Review Team อัตโนมัติเพื่อตรวจสอบคุณภาพโค้ดหลังการดำเนินงาน

### ผู้เชี่ยวชาญวิจัย
เวิร์กโฟลว์การทำงานร่วมกันแบบมัลติเอเจนต์ ออกแบบสำหรับงานวิจัยและวิเคราะห์:
1. ส่งเอเจนต์คู่ขนานหลายตัวเพื่อวิจัยจากมิติต่าง ๆ (สำรวจอุตสาหกรรม, บทความวิชาการ, ข่าว, วิเคราะห์คู่แข่ง ฯลฯ)
2. มอบหมายเอเจนต์เพื่อสังเคราะห์โซลูชันเป้าหมายพร้อมตรวจสอบความเข้มงวดและความน่าเชื่อถือของแหล่งข้อมูล
3. ส่งเอเจนต์เพื่อสร้างเดโมผลิตภัณฑ์ (HTML, Markdown ฯลฯ) (ตัวเลือก)
4. สังเคราะห์ข้อค้นพบทั้งหมดเป็นแผนการดำเนินงานที่ครอบคลุม
5. ส่งเอเจนต์ตรวจสอบหลายตัวเพื่อพิจารณาแผนจากบทบาทและมุมมองที่หลากหลาย
6. ดำเนินการตามแผนเมื่อได้รับอนุมัติ

---

## Raw Templates

Below are the two raw prompt templates UltraPlan actually sends to Claude Code (see `src/utils/ultraplanTemplates.js`):

### Code Expert (codeExpert)

<textarea readonly><system-reminder>
[SCOPED INSTRUCTION] The following instructions apply only to the next 1–3 interactions. Once the task is complete, these instructions should gradually decrease in priority and no longer affect subsequent interactions. You should be adept at utilizing tools such as `AskUserQuestion`, `EnterPlanMode`, and `TeamCreate`, rather than relying solely on plain text processing. Before execution, you must ensure that the `EnterPlanMode`, `ExitPlanMode`, `SendMessage`, `TaskCreate`, `TaskUpdate`, `TaskStop`, `TaskGet`, `TaskOutput` and `TaskList` tools are loaded.

Pre-requisite: Use `AskUserQuestion` to clarify user intent whenever the request is ambiguous (target element, interaction style, scope of platforms, etc.). Skip only if the intent is unambiguous.

Leverage a multi-agent exploration mechanism to formulate a highly detailed implementation plan.

Instructions:
1. Use the `Agent` tool to spawn parallel agents that simultaneously explore different aspects of the codebase:
- If necessary, assign a preliminary researcher to use the `webSearch` tool to first investigate cutting-edge solutions in the relevant industry domain;
- One agent responsible for understanding the relevant existing code and architecture;
- One agent responsible for identifying all files that need to be modified;
- One agent responsible for identifying potential risks, edge cases, and dependencies;
- You may add other roles or deploy additional agents beyond the three listed above; the maximum number of concurrently dispatched agents is 5.

2. Synthesize the findings from all agents into a detailed, step-by-step implementation plan.

3. Use the `Agent` tool to spawn 2-3 review agents that examine the plan from different perspectives, checking for missing steps, potential risks, or corresponding mitigation strategies.

4. Integrate the feedback gathered during the review process, then call `ExitPlanMode` to submit your final plan.

5. Once `ExitPlanMode` returns a result:
- If approved: proceed to execute the plan within this session.
- If rejected: revise the plan based on the feedback provided and call `ExitPlanMode` again.
- If an error occurs (including receiving a "Not in Plan Mode" message): do **not** follow the suggestions provided in the error message; instead, prompt the user for further instructions.

Your final plan must include the following elements:
- A clear summary of the implementation strategy;
- An ordered list of files to be created or modified, with precise details of the required changes for each file;
- A step-by-step execution sequence;
- Testing and validation procedures;
- Potential risks and their corresponding mitigation strategies;

6. After the final plan has been successfully executed:
First run `git diff --quiet && git diff --cached --quiet` (or equivalent) to detect whether the working tree actually has non-trivial changes; if there are no real changes (or only whitespace/comment-only edits), skip the UltraReview step.
Otherwise, if the project is managed with Git:
Initiate a team (`TeamCreate`), dynamically allocating the number of teammates based on task complexity (5 is recommended);
If the `TeamCreate` tool is unavailable, spawn teammates directly with the `Agent` tool (note: as teammates, not plain subagents);
Task: Conduct a Code Review of the current git changes from multiple perspectives;
Pre-requisites:
- The git repository may be located in a subdirectory of the current directory; prefer `git rev-parse --show-toplevel` (fall back to recursive lookup) before proceeding;
- In the case of multiple repositories, tasks may be executed separately;
The team's goal is to analyze the current Git change log and validate each modification from different perspectives, specifically including:
- Whether requirements/objectives have been met and functionality is complete;
- Whether newly added code introduces side effects, breaks existing functionality, or poses potential risks;
- Code quality: naming, readability, complexity, technical debt, maintainability;
- Testing and documentation: whether there is adequate test coverage, and whether critical logic has necessary comments or documentation;
- Dependencies and compatibility: whether new dependencies or version compatibility issues have been introduced;
Workflow:
- Each teammate, according to their own role, covers the review dimensions one by one and independently outputs a report;
- After consolidating the reports, perform a cross-review to identify conflicts or shared concerns;
- Distill specific, actionable modification suggestions and annotate them with priority levels (P0/P1/P2/P3);
- Upon completion, adopt P0 items, and selectively adopt P1 items when they are concrete and low-risk; defer P2/P3 to backlog;
- After execution is complete, close the team (`TeamDelete`);
- If the `TeamDelete` tool is unavailable, notify each teammate to exit individually;
</system-reminder></textarea>

### Research Expert (researchExpert)

<textarea readonly><system-reminder>
[SCOPED INSTRUCTION] The following instructions are intended for the next 1–3 interactions. Once the task is complete, these instructions should be gradually deprioritized and no longer influence subsequent interactions.You should be adept at utilizing tools such as `AskUserQuestion`, `EnterPlanMode` and `WebSearch`, rather than relying solely on plain text processing. Before execution, you must ensure that the `EnterPlanMode`, `ExitPlanMode`, `TaskCreate`, `TaskUpdate`, `TaskStop`, `TaskGet`, `TaskOutput` and `TaskList` tools are loaded.

Pre-requisite: Use `AskUserQuestion` to clarify the research scope, target audience, and deliverable format whenever the user's intent is ambiguous. Skip only if the intent is unambiguous.

Leverage a multi-agent exploration mechanism to formulate an exceptionally detailed implementation plan.

Instructions:
1. Utilize the Agent tool to spawn parallel agents that simultaneously explore various facets of the requirements:
- If necessary, deploy a preliminary investigator to conduct an initial survey of industry-specific solutions using `webSearch`;
- If necessary, deploy a specialized investigator to research authoritative sources—such as academic papers, news articles, and research reports—using `webSearch`;
- Assign an agent to synthesize the target solution, while simultaneously verifying the rigor and credibility of the gathered papers, news, and research reports;
- If necessary, assign an agent to analyze competitor data to provide supplementary analytical perspectives;
- If necessary, assign an agent to handle the implementation of a product demo (generating outputs such as HTML, Markdown, etc.);
- If the task is sufficiently complex, you may assign additional teammates to the roles defined above, or introduce other specialized roles; you are permitted to schedule up to 5 teammates concurrently.

2. Synthesize the findings from the aforementioned agents into a comprehensive, step-by-step implementation plan.

3. Utilize the Agent tool to spawn a set of parallel review agents; these agents shall scrutinize the plan from multiple roles and perspectives to identify any omitted steps and to propose reasonable additions or optimizations.

4. Consolidate the feedback received from the review agents, then invoke `ExitPlanMode` to submit your final plan.

5. Upon receiving the result from `ExitPlanMode`:
- If Approved: Proceed to execute the plan within this current session.
- If Rejected: Revise the plan based on the provided feedback, and then invoke `ExitPlanMode` once again.
- If an Error Occurs (including the message "Not in Plan Mode"): Do *not* follow the suggestions provided by the error message; instead, prompt the user for further instructions.

Your final plan must include the following elements:
- A clear summary of the proposed implementation strategy;
- An ordered list of files to be created or modified, specifying the exact changes required for each;
- A step-by-step sequence for executing the implementation;
- Identification of potential risks and corresponding mitigation strategies;
- Creative ideation and suggestions for advanced enhancements;
- If a product demo was generated, place the corresponding demo output in an appropriate location and notify the user.
</system-reminder></textarea>
