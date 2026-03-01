# Skill

## التعريف

تنفيذ مهارة (skill) في المحادثة الرئيسية. المهارات هي قدرات متخصصة يمكن للمستخدم استدعاؤها عبر أوامر slash (مثل `/commit`، `/review-pr`).

## المعاملات

| المعامل | النوع | مطلوب | الوصف |
|---------|-------|-------|-------|
| `skill` | string | نعم | اسم المهارة (مثل "commit"، "review-pr"، "pdf") |
| `args` | string | لا | معاملات المهارة |

## سيناريوهات الاستخدام

**مناسب للاستخدام:**
- أدخل المستخدم أمر slash بتنسيق `/<skill-name>`
- طلب المستخدم يتطابق مع وظيفة مهارة مسجلة

**غير مناسب للاستخدام:**
- أوامر CLI المدمجة (مثل `/help`، `/clear`)
- مهارة قيد التشغيل بالفعل
- اسم مهارة غير موجود في قائمة المهارات المتاحة

## ملاحظات

- بعد استدعاء المهارة تتوسع إلى prompt كامل
- يدعم الأسماء المؤهلة بالكامل (مثل `ms-office-suite:pdf`)
- قائمة المهارات المتاحة تُقدم في رسائل system-reminder
- عند رؤية وسم `<command-name>` فهذا يعني أن المهارة محملة بالفعل، يجب التنفيذ مباشرة بدلاً من استدعاء هذه الأداة مرة أخرى
- لا تذكر مهارة دون استدعاء الأداة فعلياً

## الأهمية في cc-viewer

يظهر استدعاء Skill في سجل الطلبات ككتلة محتوى `tool_use`. يؤثر prompt المهارة الموسع على system prompt أو محتوى الرسائل في الطلبات اللاحقة.

## النص الأصلي

<textarea readonly>Execute a skill within the main conversation

When users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.

When users reference a "slash command" or "/<something>" (e.g., "/commit", "/review-pr"), they are referring to a skill. Use this tool to invoke it.

How to invoke:
- Use this tool with the skill name and optional arguments
- Examples:
  - `skill: "pdf"` - invoke the pdf skill
  - `skill: "commit", args: "-m 'Fix bug'"` - invoke with arguments
  - `skill: "review-pr", args: "123"` - invoke with arguments
  - `skill: "ms-office-suite:pdf"` - invoke using fully qualified name

Important:
- Available skills are listed in system-reminder messages in the conversation
- When a skill matches the user's request, this is a BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response about the task
- NEVER mention a skill without actually calling this tool
- Do not invoke a skill that is already running
- Do not use this tool for built-in CLI commands (like /help, /clear, etc.)
- If you see a <command-name> tag in the current conversation turn, the skill has ALREADY been loaded - follow the instructions directly instead of calling this tool again
</textarea>
