# TaskList

## التعريف

عرض جميع المهام في قائمة المهام، لمراجعة التقدم العام والأعمال المتاحة.

## المعاملات

لا توجد معاملات.

## المحتوى المُرجع

معلومات ملخصة لكل مهمة:
- `id` — معرف المهمة
- `subject` — وصف مختصر
- `status` — الحالة: `pending`، `in_progress` أو `completed`
- `owner` — المسؤول (معرف agent)، فارغ يعني غير مُعيَّن
- `blockedBy` — قائمة معرفات المهام غير المكتملة التي تحظر هذه المهمة

## سيناريوهات الاستخدام

**مناسب للاستخدام:**
- عرض المهام المتاحة (حالة pending، بدون owner، غير محظورة)
- فحص التقدم العام للمشروع
- البحث عن المهام المحظورة
- البحث عن المهمة التالية بعد إكمال مهمة

## ملاحظات

- يُفضل معالجة المهام بترتيب المعرف (الأصغر أولاً)، لأن المهام المبكرة عادة توفر سياقاً للمهام اللاحقة
- المهام التي لديها `blockedBy` لا يمكن المطالبة بها قبل رفع التبعية
- استخدم TaskGet للحصول على التفاصيل الكاملة لمهمة محددة

## الأهمية في cc-viewer

TaskList هي عملية إدارة مهام داخلية، لا تنتج طلب API مستقل.

## النص الأصلي

<textarea readonly>Use this tool to list all tasks in the task list.

## When to Use This Tool

- To see what tasks are available to work on (status: 'pending', no owner, not blocked)
- To check overall progress on the project
- To find tasks that are blocked and need dependencies resolved
- After completing a task, to check for newly unblocked work or claim the next available task
- **Prefer working on tasks in ID order** (lowest ID first) when multiple tasks are available, as earlier tasks often set up context for later ones

## Output

Returns a summary of each task:
- **id**: Task identifier (use with TaskGet, TaskUpdate)
- **subject**: Brief description of the task
- **status**: 'pending', 'in_progress', or 'completed'
- **owner**: Agent ID if assigned, empty if available
- **blockedBy**: List of open task IDs that must be resolved first (tasks with blockedBy cannot be claimed until dependencies resolve)

Use TaskGet with a specific task ID to view full details including description and comments.
</textarea>
