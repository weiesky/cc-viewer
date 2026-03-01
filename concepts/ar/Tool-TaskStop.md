# TaskStop

## التعريف

إيقاف مهمة خلفية قيد التشغيل.

## المعاملات

| المعامل | النوع | مطلوب | الوصف |
|---------|-------|-------|-------|
| `task_id` | string | لا | معرف المهمة الخلفية المراد إيقافها |
| `shell_id` | string | لا | مهمل، استخدم `task_id` بدلاً منه |

## سيناريوهات الاستخدام

**مناسب للاستخدام:**
- إنهاء المهام طويلة التشغيل التي لم تعد مطلوبة
- إلغاء المهام الخلفية التي بدأت بالخطأ

## ملاحظات

- يُرجع حالة نجاح أو فشل
- معامل `shell_id` مهمل، يجب استخدام `task_id`

## الأهمية في cc-viewer

استدعاء TaskStop بحد ذاته لا ينتج طلب API، وهو عملية إدارة مهام داخلية في Claude Code.

## النص الأصلي

<textarea readonly>
- Stops a running background task by its ID
- Takes a task_id parameter identifying the task to stop
- Returns a success or failure status
- Use this tool when you need to terminate a long-running task
</textarea>
