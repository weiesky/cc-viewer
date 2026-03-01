# TaskUpdate

## التعريف

تحديث حالة أو محتوى أو علاقات التبعية لمهمة معينة في قائمة المهام.

## المعاملات

| المعامل | النوع | مطلوب | الوصف |
|---------|-------|-------|-------|
| `taskId` | string | نعم | معرف المهمة المراد تحديثها |
| `status` | enum | لا | الحالة الجديدة: `pending` / `in_progress` / `completed` / `deleted` |
| `subject` | string | لا | العنوان الجديد |
| `description` | string | لا | الوصف الجديد |
| `activeForm` | string | لا | نص بصيغة المضارع المستمر يُعرض أثناء التنفيذ |
| `owner` | string | لا | المسؤول الجديد عن المهمة (اسم agent) |
| `metadata` | object | لا | بيانات وصفية للدمج (تعيين القيمة إلى null لحذف المفتاح) |
| `addBlocks` | string[] | لا | قائمة معرفات المهام المحظورة بواسطة هذه المهمة |
| `addBlockedBy` | string[] | لا | قائمة معرفات المهام السابقة التي تحظر هذه المهمة |

## تدفق الحالات

```
pending → in_progress → completed
```

يمكن الانتقال إلى `deleted` من أي حالة، مما يزيل المهمة نهائياً.

## سيناريوهات الاستخدام

**مناسب للاستخدام:**
- تعيين المهمة كـ `in_progress` عند بدء العمل
- تعيين المهمة كـ `completed` بعد إنجاز العمل
- تعيين علاقات التبعية بين المهام
- تحديث محتوى المهمة عند تغيير المتطلبات

**قواعد مهمة:**
- لا تعيّن المهمة كـ `completed` إلا عند إنجازها بالكامل
- عند مواجهة أخطاء أو عوائق، أبقِ الحالة `in_progress`
- لا يجوز تعيين `completed` عند فشل الاختبارات أو عدم اكتمال التنفيذ أو وجود أخطاء غير محلولة

## ملاحظات

- قبل التحديث يجب الحصول على أحدث حالة للمهمة عبر TaskGet لتجنب البيانات القديمة
- بعد إكمال المهمة استدعِ TaskList للبحث عن المهمة التالية المتاحة

## الأهمية في cc-viewer

TaskUpdate هي عملية إدارة مهام داخلية، لا تنتج طلب API مستقل.

## النص الأصلي

<textarea readonly>Use this tool to update a task in the task list.

## When to Use This Tool

**Mark tasks as resolved:**
- When you have completed the work described in a task
- When a task is no longer needed or has been superseded
- IMPORTANT: Always mark your assigned tasks as resolved when you finish them
- After resolving, call TaskList to find your next task

- ONLY mark a task as completed when you have FULLY accomplished it
- If you encounter errors, blockers, or cannot finish, keep the task as in_progress
- When blocked, create a new task describing what needs to be resolved
- Never mark a task as completed if:
  - Tests are failing
  - Implementation is partial
  - You encountered unresolved errors
  - You couldn't find necessary files or dependencies

**Delete tasks:**
- When a task is no longer relevant or was created in error
- Setting status to `deleted` permanently removes the task

**Update task details:**
- When requirements change or become clearer
- When establishing dependencies between tasks

## Fields You Can Update

- **status**: The task status (see Status Workflow below)
- **subject**: Change the task title (imperative form, e.g., "Run tests")
- **description**: Change the task description
- **activeForm**: Present continuous form shown in spinner when in_progress (e.g., "Running tests")
- **owner**: Change the task owner (agent name)
- **metadata**: Merge metadata keys into the task (set a key to null to delete it)
- **addBlocks**: Mark tasks that cannot start until this one completes
- **addBlockedBy**: Mark tasks that must complete before this one can start

## Status Workflow

Status progresses: `pending` → `in_progress` → `completed`

Use `deleted` to permanently remove a task.

## Staleness

Make sure to read a task's latest state using `TaskGet` before updating it.

## Examples

Mark task as in progress when starting work:
```json
{"taskId": "1", "status": "in_progress"}
```

Mark task as completed after finishing work:
```json
{"taskId": "1", "status": "completed"}
```

Delete a task:
```json
{"taskId": "1", "status": "deleted"}
```

Claim a task by setting owner:
```json
{"taskId": "1", "owner": "my-name"}
```

Set up task dependencies:
```json
{"taskId": "2", "addBlockedBy": ["1"]}
```
</textarea>
