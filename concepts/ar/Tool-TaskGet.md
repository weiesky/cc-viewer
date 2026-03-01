# TaskGet

## التعريف

الحصول على التفاصيل الكاملة للمهمة عبر معرف المهمة.

## المعاملات

| المعامل | النوع | مطلوب | الوصف |
|---------|-------|-------|-------|
| `taskId` | string | نعم | معرف المهمة المراد الحصول عليها |

## المحتوى المُرجع

- `subject` — عنوان المهمة
- `description` — المتطلبات التفصيلية والسياق
- `status` — الحالة: `pending`، `in_progress` أو `completed`
- `blocks` — قائمة المهام المحظورة بواسطة هذه المهمة
- `blockedBy` — قائمة المهام السابقة التي تحظر هذه المهمة

## سيناريوهات الاستخدام

**مناسب للاستخدام:**
- الحصول على الوصف الكامل والسياق قبل بدء العمل
- فهم علاقات التبعية للمهمة
- الحصول على المتطلبات الكاملة بعد تعيين المهمة

## ملاحظات

- بعد الحصول على المهمة يجب التحقق من أن قائمة `blockedBy` فارغة قبل بدء العمل
- استخدم TaskList لعرض معلومات ملخصة لجميع المهام

## الأهمية في cc-viewer

TaskGet هي عملية إدارة مهام داخلية، لا تنتج طلب API مستقل.

## النص الأصلي

<textarea readonly>Use this tool to retrieve a task by its ID from the task list.

## When to Use This Tool

- When you need the full description and context before starting work on a task
- To understand task dependencies (what it blocks, what blocks it)
- After being assigned a task, to get complete requirements

## Output

Returns full task details:
- **subject**: Task title
- **description**: Detailed requirements and context
- **status**: 'pending', 'in_progress', or 'completed'
- **blocks**: Tasks waiting on this one to complete
- **blockedBy**: Tasks that must complete before this one can start

## Tips

- After fetching a task, verify its blockedBy list is empty before beginning work.
- Use TaskList to see all tasks in summary form.
</textarea>
