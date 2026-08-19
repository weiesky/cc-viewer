# Custom UltraPlan Expert — دليل التأليف

## ما الذي يفعله حقلا الإدخال

- **اسم الخبير**: التسمية المعروضة على زر الدور في صف خيارات UltraPlan (بحد أقصى 30 حرفًا). إنه مجرد اسم عرض ولا يُرسل **أبدًا** إلى Claude Code.
- **نص الموجّه (Prompt body)**: تعليمات الدور الخاصة بك. عند إنشاء خبير جديد، يأتي المحرر **مُعبّأً مسبقًا** بغلاف `<system-reminder>...</system-reminder>` وترويسة النطاق `[SCOPED INSTRUCTION]` الخاصة به — **اكتب تعليمات الدور داخل الغلاف**. لن يقوم cc-viewer بالتغليف مرتين: إن كان الغلاف موجودًا يُرسل كما هو؛ وإن أزلته، يضيف cc-viewer واحدًا عند الإرسال.

---

## كيف يبدو قالب الخبير؟

كل خبير مدمج (Code Expert / Research Expert) هو في الأساس كتلة `<system-reminder>` يتم حقنها في سياق Claude Code. يمر خبيرك المخصص عبر خط الأنابيب نفسه تمامًا. إليك تفصيل قالب **Research Expert**:

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

## التحليل قسمًا بقسم

### 1. ترويسة نطاق `[SCOPED INSTRUCTION]` (الغلاف — مُعبّأ مسبقًا لك)
> The following instructions are intended for the next 1–3 interactions...

يُخبر هذا Claude Code: **هذه التعليمات نشطة فقط للأدوار الـ 1–3 التالية**، ثم تتلاشى. يمنع تسرب «شخصية الخبير» إلى محادثات لاحقة غير ذات صلة.

**يأتي هذا السطر مُعبّأً مسبقًا في المحرر — اتركه كما هو؛ لست بحاجة لإعادة كتابته.**

### 2. تعريف المهمة الافتتاحي (**هذا ما يجب عليك إعادة كتابته**)
> Leverage a multi-agent exploration mechanism to formulate an exceptionally detailed implementation plan.

هذا هو «المبتدأ-الخبر-المفعول» للقالب بأكمله: **يخبر Claude Code بالموقف والهدف**. الافتراضي «استكشاف متعدد الوكلاء + خطة تنفيذ» يناسب جيدًا مهام **هندسة البرمجيات / التخطيط**، لكنه يبدو غير ملائم للعديد من المجالات الأخرى (مراجعة المحتوى، تحليل البيانات، كتابة النصوص الإعلانية، أبحاث السوق، تدقيق الامتثال…).

**نوصي بشدة بإعادة كتابة هذا السطر لهدفك**، على سبيل المثال:

- **مراجع محتوى**: "You are a senior content reviewer specializing in {domain}. Your goal is to identify factual inaccuracies, tone inconsistencies, and structural weaknesses in the provided material."
- **محلل تنافسي**: "Conduct a rigorous competitive analysis for {product category}. Produce a comparison matrix, positioning insights, and strategic recommendations."
- **كاتب إعلانات**: "Generate multiple creative copy variants for {scenario}, each with distinct positioning, tone, and call-to-action strategy."

### 3. خطوات سير العمل (1–5 عناصر — **اقتطع أو وسّع بناءً على التعقيد**)

يحتوي Research Expert على 5 خطوات: **استكشاف ← توليف ← مراجعة ← تقديم الخطة ← تنفيذ**. هذا يفرض «وكلاء متعددين متوازيين + مراجعة متقاطعة + اعتماد الخطة» — ثلاث طبقات من الصرامة، مناسبة للمهام عالية المخاطر/واسعة النطاق ولكنها **مبالغ فيها للمهام الخفيفة**.

- **مهمة بسيطة** (بحث منفرد / إصلاح صغير): أسقط إيفاد الوكلاء المتعددين والمراجعة؛ فقط «أنتج الإجابة» في خطوة واحدة.
- **مهمة متوسطة**: احتفظ بـ «استكشاف ← توليف ← مراجعة»؛ أسقط رقصة ExitPlanMode؛ سلّم النتيجة مباشرة.
- **مهمة معقدة عالية التكلفة** (إعادة هيكلة كبيرة، مقارنة خيارات متعددة، بحث متعدد المجالات): احتفظ بجميع الخطوات الـ 5، ربما أضف خطوة «نموذج المخاطر» أو «مصفوفة مقارنة الخيارات».

### 4. الأدوار الفرعية في الخطوة 1 (**فصّلها لمجالك**)

يُدرج Research Expert 6 أدوار محتملة (مستكشف صناعة، باحث أكاديمي، مُولِّف + مدقق حقائق، محلل منافسين، منتج demo، فتحة قابلة للتوسيع). **أعد كتابة هذه القائمة لسيناريوك**:

- **الكتابة**: "source collector + style analyst + fact checker"
- **تحليل البيانات**: "data-cleaning agent + statistical modeling agent + visualization agent"
- **تدقيق الكود**: "static-analysis agent + dependency-chain auditor + threat modeler"

### 5. قائمة فحص المخرجات النهائية (**وائمها مع حاجتك الفعلية**)

> Your final plan must include the following elements: ...

يُدرج القالب الأصلي 6 عناصر لـ «خطة التنفيذ». قد يكون مخرجك شيئًا مختلفًا تمامًا:

- **تقرير بحثي** → "Executive summary / Methodology / Key findings / Limitations / Action recommendations"
- **تقرير مراجعة** → "Issue list / Severity rating / Fix suggestions / Before-after examples"
- **مصفوفة مقارنة** → "Dimension definitions / Scoring rubric / Conclusions / Recommendation rationale"

---

## نصائح التأليف (TL;DR)

1. **أعد كتابة الجملة الافتتاحية**: اذكر الدور والهدف وصيغة المخرجات في سطر واحد.
2. **مرّن سير العمل**: 1–2 خطوة للمهام الخفيفة، الحلقة الكاملة المكونة من 5 خطوات للمعقدة فقط.
3. **أعد كتابة الأدوار الفرعية للخطوة 1**: الافتراضات (الأوراق الأكاديمية / المنافسون / demo) ربما ليست ما تريد.
4. **«قائمة فحص المخرجات» النهائية هي معيار الجودة لديك**: حدد بنية المخرجات — سيتبعها Claude Code بصرامة.

---

## مثال معاد هيكلته: Competitive Analyst

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

مقارنة بـ Research Expert الأصلي: تم اختصاره إلى 4 خطوات، خُفِّضت الأدوار الفرعية من 6 إلى 3، وأُعيدت كتابة قائمة المخرجات بالكامل كـ «أقسام تقرير».
