# UltraPlan — آلة الأمنيات المطلقة

## ما هو UltraPlan

UltraPlan هو **التنفيذ المحلي** من cc-viewer لأمر `/ultraplan` الأصلي في Claude Code. يتيح لك استخدام الإمكانيات الكاملة لـ `/ultraplan` في بيئتك المحلية **دون الحاجة إلى تشغيل خدمة Claude الرسمية عن بُعد**، موجهاً Claude Code لإنجاز مهام التخطيط والتنفيذ المعقدة باستخدام **التعاون متعدد الوكلاء**.

مقارنة بوضع Plan العادي أو Agent Team، يستطيع UltraPlan:
- يقدم أدوار **خبير الكود** و**خبير الأبحاث** المصممة لأنواع مختلفة من المهام
- نشر عدة وكلاء متوازيين لاستكشاف قاعدة الكود أو إجراء الأبحاث من أبعاد مختلفة
- دمج البحث الخارجي (webSearch) للحصول على أفضل الممارسات في المجال
- تجميع فريق Code Review تلقائياً بعد تنفيذ الخطة لمراجعة الشفرة
- تشكيل حلقة مغلقة كاملة **خطة → تنفيذ → مراجعة → إصلاح**

---

## ملاحظات مهمة

### 1. UltraPlan ليس كلي القدرة
UltraPlan هو آلة أمنيات أكثر قوة، لكن هذا لا يعني أن كل أمنية يمكن تحقيقها. إنه أقوى من Plan و Agent Team، لكنه لا يستطيع مباشرة "جعلك تربح المال". خذ بعين الاعتبار حجم المهام المعقول — قسم الأهداف الكبيرة إلى مهام متوسطة قابلة للتنفيذ بدلاً من محاولة إنجاز كل شيء دفعة واحدة.

### 2. الأكثر فعالية حالياً لمشاريع البرمجة
قوالب UltraPlan وسير العمل الخاص به محسنة بعمق لمشاريع البرمجة. يمكن تجربة سيناريوهات أخرى (التوثيق، تحليل البيانات، إلخ.)، لكن قد ترغب في انتظار تكييفات الإصدارات المستقبلية.

### 3. وقت التنفيذ ومتطلبات نافذة السياق
- يستغرق تشغيل UltraPlan الناجح عادةً **30 دقيقة أو أكثر**
- يتطلب أن يمتلك MainAgent نافذة سياق كبيرة (يُوصى بنموذج Opus بسياق 1M)
- إذا كان لديك نموذج 200K فقط، **تأكد من تنفيذ `/clear` للسياق قبل التشغيل**
- يعمل أمر `/compact` في Claude Code بشكل سيئ عندما تكون نافذة السياق غير كافية — تجنب نفاد المساحة
- الحفاظ على مساحة سياق كافية هو شرط أساسي حاسم لنجاح تنفيذ UltraPlan

إذا كانت لديك أي أسئلة أو اقتراحات حول UltraPlan المحلي، لا تتردد في فتح [Issues على GitHub](https://github.com/anthropics/claude-code/issues) للمناقشة والتعاون.

---

## كيف يعمل

يقدم UltraPlan دورين خبيرين، مصممين لأنواع مختلفة من المهام:

### خبير الكود
سير عمل تعاوني متعدد الوكلاء مصمم لمشاريع البرمجة:
1. نشر ما يصل إلى 5 وكلاء متوازيين لاستكشاف قاعدة الكود في آن واحد (الهندسة المعمارية، تحديد الملفات، تقييم المخاطر، إلخ)
2. اختيارياً: نشر وكيل بحث للتحقيق في حلول الصناعة عبر webSearch
3. تجميع جميع نتائج الوكلاء في خطة تنفيذ مفصلة
4. نشر وكيل مراجعة لفحص الخطة من عدة زوايا
5. تنفيذ الخطة بعد الموافقة
6. تشكيل فريق Code Review تلقائياً للتحقق من جودة الكود بعد التنفيذ

### خبير الأبحاث
سير عمل تعاوني متعدد الوكلاء مصمم لمهام البحث والتحليل:
1. نشر عدة وكلاء متوازيين للبحث من أبعاد مختلفة (دراسات صناعية، أوراق أكاديمية، أخبار، تحليل تنافسي، إلخ)
2. تعيين وكيل لتجميع الحل المستهدف مع التحقق من دقة ومصداقية المصادر المجمعة
3. اختيارياً: نشر وكيل لإنشاء عرض توضيحي للمنتج (HTML، Markdown، إلخ)
4. تجميع جميع النتائج في خطة تنفيذ شاملة
5. نشر عدة وكلاء مراجعة لفحص الخطة من أدوار وزوايا مختلفة
6. تنفيذ الخطة بعد الموافقة

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
