# TaskCreate

## التعريف

إنشاء عناصر قائمة مهام منظمة، لتتبع التقدم وتنظيم المهام المعقدة وعرض تقدم العمل للمستخدم.

## المعاملات

| المعامل | النوع | مطلوب | الوصف |
|---------|-------|-------|-------|
| `subject` | string | نعم | عنوان مختصر للمهمة، بصيغة الأمر (مثل "Fix authentication bug") |
| `description` | string | نعم | وصف تفصيلي يتضمن السياق ومعايير القبول |
| `activeForm` | string | لا | نص بصيغة المضارع المستمر يُعرض أثناء التنفيذ (مثل "Fixing authentication bug") |
| `metadata` | object | لا | بيانات وصفية عشوائية مرفقة بالمهمة |

## سيناريوهات الاستخدام

**مناسب للاستخدام:**
- المهام المعقدة متعددة الخطوات (أكثر من 3 خطوات)
- المستخدم قدم عدة عناصر مهام
- تتبع العمل في وضع التخطيط
- المستخدم طلب صراحة استخدام قائمة المهام

**غير مناسب للاستخدام:**
- مهمة واحدة بسيطة
- عمليات بسيطة من 3 خطوات أو أقل
- محادثة بحتة أو استعلام معلومات

## ملاحظات

- جميع المهام الجديدة تبدأ بحالة `pending`
- `subject` بصيغة الأمر ("Run tests")، `activeForm` بصيغة المضارع المستمر ("Running tests")
- بعد إنشاء المهمة يمكن تعيين التبعيات (blocks/blockedBy) عبر TaskUpdate
- قبل الإنشاء يجب استدعاء TaskList للتحقق من عدم وجود مهام مكررة

## الأهمية في cc-viewer

TaskCreate هي عملية إدارة مهام داخلية في Claude Code، لا تنتج طلب API مستقل. لكن في Chat Mode يمكن رؤية كتلة tool_use التي يستدعي فيها النموذج هذه الأداة.

## النص الأصلي

<textarea readonly>Use this tool to create a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

## When to Use This Tool

Use this tool proactively in these scenarios:

- Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
- Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
- Plan mode - When using plan mode, create a task list to track the work
- User explicitly requests todo list - When the user directly asks you to use the todo list
- User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
- After receiving new instructions - Immediately capture user requirements as tasks
- When you start working on a task - Mark it as in_progress BEFORE beginning work
- After completing a task - Mark it as completed and add any new follow-up tasks discovered during implementation

## When NOT to Use This Tool

Skip using this tool when:
- There is only a single, straightforward task
- The task is trivial and tracking it provides no organizational benefit
- The task can be completed in less than 3 trivial steps
- The task is purely conversational or informational

NOTE that you should not use this tool if there is only one trivial task to do. In this case you are better off just doing the task directly.

## Task Fields

- **subject**: A brief, actionable title in imperative form (e.g., "Fix authentication bug in login flow")
- **description**: Detailed description of what needs to be done, including context and acceptance criteria
- **activeForm**: Present continuous form shown in spinner when task is in_progress (e.g., "Fixing authentication bug"). This is displayed to the user while you work on the task.

**IMPORTANT**: Always provide activeForm when creating tasks. The subject should be imperative ("Run tests") while activeForm should be present continuous ("Running tests"). All tasks are created with status `pending`.

## Tips

- Create tasks with clear, specific subjects that describe the outcome
- Include enough detail in the description for another agent to understand and complete the task
- After creating tasks, use TaskUpdate to set up dependencies (blocks/blockedBy) if needed
- Check TaskList first to avoid creating duplicate tasks
</textarea>
