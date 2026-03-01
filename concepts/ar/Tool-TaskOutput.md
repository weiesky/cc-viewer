# TaskOutput

## التعريف

الحصول على مخرجات المهام الخلفية قيد التشغيل أو المكتملة. ينطبق على shell الخلفية والوكلاء غير المتزامنين والجلسات البعيدة.

## المعاملات

| المعامل | النوع | مطلوب | الوصف |
|---------|-------|-------|-------|
| `task_id` | string | نعم | معرف المهمة |
| `block` | boolean | نعم | هل ينتظر بشكل محظور حتى اكتمال المهمة، الافتراضي `true` |
| `timeout` | number | نعم | أقصى وقت انتظار (بالمللي ثانية)، الافتراضي 30000، الحد الأقصى 600000 |

## سيناريوهات الاستخدام

**مناسب للاستخدام:**
- فحص تقدم الوكلاء الخلفيين المُطلقين عبر Task (`run_in_background: true`)
- الحصول على نتائج تنفيذ أوامر Bash الخلفية
- انتظار اكتمال المهام غير المتزامنة والحصول على المخرجات

**غير مناسب للاستخدام:**
- المهام الأمامية — تُرجع النتائج مباشرة، لا حاجة لهذه الأداة

## ملاحظات

- `block: true` يحظر حتى اكتمال المهمة أو انتهاء المهلة
- `block: false` للفحص غير المحظور للحالة الحالية
- يمكن العثور على معرف المهمة عبر أمر `/tasks`
- ينطبق على جميع أنواع المهام: shell الخلفية، الوكلاء غير المتزامنين، الجلسات البعيدة

## الأهمية في cc-viewer

استدعاء TaskOutput بحد ذاته لا ينتج طلب API، فهو عملية إدارة مهام داخلية في Claude Code ولا يظهر في سجل الطلبات.

## النص الأصلي

<textarea readonly>- Retrieves output from a running or completed task (background shell, agent, or remote session)
- Takes a task_id parameter identifying the task
- Returns the task output along with status information
- Use block=true (default) to wait for task completion
- Use block=false for non-blocking check of current status
- Task IDs can be found using the /tasks command
- Works with all task types: background shells, async agents, and remote sessions</textarea>
