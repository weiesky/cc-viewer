# ExitPlanMode

## التعريف

الخروج من وضع التخطيط وتقديم الخطة للمستخدم للموافقة. يُقرأ محتوى الخطة من ملف الخطة المكتوب مسبقاً.

## المعاملات

| المعامل | النوع | مطلوب | الوصف |
|---------|-------|-------|-------|
| `allowedPrompts` | array | لا | قائمة أوصاف الأذونات المطلوبة لخطة التنفيذ |

كل عنصر في مصفوفة `allowedPrompts`:

| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `tool` | enum | نعم | الأداة المعنية، حالياً يُدعم فقط `Bash` |
| `prompt` | string | نعم | وصف دلالي للعملية (مثل "run tests"، "install dependencies") |

## سيناريوهات الاستخدام

**مناسب للاستخدام:**
- اكتملت الخطة في وضع التخطيط وجاهزة لتقديمها لموافقة المستخدم
- يُستخدم فقط لمهام التنفيذ التي تتطلب كتابة كود

**غير مناسب للاستخدام:**
- مهام البحث/الاستكشاف البحتة — لا حاجة للخروج من وضع التخطيط
- السؤال "هل الخطة مقبولة؟" — هذا بالضبط وظيفة هذه الأداة، لا تستخدم AskUserQuestion لذلك

## ملاحظات

- هذه الأداة لا تقبل محتوى الخطة كمعامل — تقرأ من ملف الخطة المكتوب مسبقاً
- سيرى المستخدم محتوى ملف الخطة للموافقة
- لا تستخدم AskUserQuestion قبل استدعاء هذه الأداة للسؤال "هل الخطة مقبولة"، فهذا تكرار
- لا تذكر "الخطة" في الأسئلة، لأن المستخدم لا يرى محتوى الخطة قبل ExitPlanMode

## الأهمية في cc-viewer

يمثل استدعاء ExitPlanMode نهاية مرحلة التخطيط. في سجل الطلبات، تتحول الطلبات بعد هذا الاستدعاء عادة إلى عمليات تنفيذية (Edit، Write، Bash إلخ).

## النص الأصلي

<textarea readonly>Use this tool when you are in plan mode and have finished writing your plan to the plan file and are ready for user approval.

## How This Tool Works
- You should have already written your plan to the plan file specified in the plan mode system message
- This tool does NOT take the plan content as a parameter - it will read the plan from the file you wrote
- This tool simply signals that you're done planning and ready for the user to review and approve
- The user will see the contents of your plan file when they review it

## When to Use This Tool
IMPORTANT: Only use this tool when the task requires planning the implementation steps of a task that requires writing code. For research tasks where you're gathering information, searching files, reading files or in general trying to understand the codebase - do NOT use this tool.

## Before Using This Tool
Ensure your plan is complete and unambiguous:
- If you have unresolved questions about requirements or approach, use AskUserQuestion first (in earlier phases)
- Once your plan is finalized, use THIS tool to request approval

**Important:** Do NOT use AskUserQuestion to ask "Is this plan okay?" or "Should I proceed?" - that's exactly what THIS tool does. ExitPlanMode inherently requests user approval of your plan.

## Examples

1. Initial task: "Search for and understand the implementation of vim mode in the codebase" - Do not use the exit plan mode tool because you are not planning the implementation steps of a task.
2. Initial task: "Help me implement yank mode for vim" - Use the exit plan mode tool after you have finished planning the implementation steps of the task.
3. Initial task: "Add a new feature to handle user authentication" - If unsure about auth method (OAuth, JWT, etc.), use AskUserQuestion first, then use exit plan mode tool after clarifying the approach.
</textarea>
