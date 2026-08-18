# TaskCreate

يُنشئ مهمة جديدة في قائمة مهام الفريق الحالي (أو قائمة مهام الجلسة عندما لا يكون هناك فريق نشط). استخدمه لالتقاط بنود العمل التي ينبغي تعقبها أو تفويضها أو مراجعتها لاحقاً.

## متى يُستخدم

- عندما يصف المستخدم قطعة عمل متعددة الخطوات تستفيد من التعقب الصريح.
- عندما تُقسم طلباً كبيراً إلى وحدات أصغر قابلة للإكمال بشكل منفصل.
- عندما يُكتشف بند متابعة في منتصف مهمة ويجب ألا يُنسى.
- عندما تحتاج إلى سجل دائم للنية قبل تسليم العمل إلى زميل فريق أو وكيل فرعي.
- عندما تعمل في وضع التخطيط وتريد تمثيل كل خطوة من الخطة بمهمة ملموسة.

تخطَّ `TaskCreate` للإجراءات التافهة ذات اللقطة الواحدة، أو للمحادثة الصرفة، أو لأي شيء يمكن إكماله في استدعاءي أدوات أو ثلاثة مباشرة.

## التفعيل

- متاح افتراضياً في معظم النماذج.
- غير متاح في عائلات Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 وما بعدها (v2.1.233+) ما لم يُفعَّل اختيارياً عبر `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` أو `--allowedTools` أو `--tools`.
- يُعطَّل نظام المهام بأكمله عند `CLAUDE_CODE_ENABLE_TASKS=false`.

## المعاملات

- `subject` (سلسلة، مطلوب): عنوان أمري قصير، مثل `Fix login redirect on Safari`. احتفظ به تحت ثمانين حرفاً تقريباً.
- `description` (سلسلة، مطلوب): سياق مفصَّل — المشكلة والقيود ومعايير القبول وأي ملفات أو روابط سيحتاجها القارئ المستقبلي. اكتب كأن زميل فريق سيتسلمها بدون سياق.
- `activeForm` (سلسلة، اختياري): نص دوَّار في صيغة المضارع المستمر يُعرض بينما المهمة `in_progress`، مثل `Fixing login redirect on Safari`. يعكس `subject` لكن بصيغة -ing.
- `metadata` (كائن، اختياري): بيانات مُنظَّمة عشوائية مُرفقة بالمهمة. الاستخدامات الشائعة: تسميات، تلميحات أولوية، معرفات تذاكر خارجية، أو إعدادات خاصة بوكيل.

المهام المُنشأة حديثاً تبدأ دائماً بحالة `pending` وبلا مالك. التبعيات (`blocks`، `blockedBy`) لا تُضبط وقت الإنشاء — طبقها لاحقاً بـ `TaskUpdate`.

## أمثلة

### مثال 1

التقط تقرير خطأ قدَّمه المستخدم لتوه.

```
TaskCreate(
  subject: "Repair broken PDF export on Windows",
  description: "Users on Windows 11 report the export button produces a 0-byte file. Reproduce with sample doc in test/fixtures/export/, then fix the code path in src/export/pdf.ts. Acceptance: export writes a valid PDF and the existing export test suite passes.",
  activeForm: "Repairing broken PDF export on Windows"
)
```

### مثال 2

قسِّم ملحمة إلى وحدات متعقَّبة عند بداية الجلسة.

```
TaskCreate(
  subject: "Draft migration plan for auth service",
  description: "Produce a written plan covering rollout stages, rollback strategy, and monitoring. Output: docs/auth-migration.md.",
  activeForm: "Drafting migration plan for auth service",
  metadata: { "priority": "P1", "linearId": "AUTH-214" }
)
```

## ملاحظات

- اكتب `subject` بصيغة الأمر و`activeForm` بصيغة المضارع المستمر حتى تُقرأ الواجهة طبيعياً عند انتقال المهمة إلى `in_progress`.
- استدعِ `TaskList` قبل الإنشاء لتجنب التكرارات — قائمة الفريق مشتركة مع زملاء الفريق والوكلاء الفرعيين.
- لا تُضمِّن أسراراً أو بيانات اعتماد في `description` أو `metadata`؛ سجلات المهام مرئية لكل من يملك الوصول إلى الفريق.
- بعد الإنشاء، حرِّك المهمة عبر دورة حياتها بـ `TaskUpdate`. لا تترك العمل مهجوراً بصمت في `in_progress`.
