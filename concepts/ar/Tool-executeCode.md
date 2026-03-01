# executeCode (mcp__ide__executeCode)

## التعريف

تنفيذ كود Python في Jupyter kernel الخاص بملف notebook الحالي.

## المعاملات

| المعامل | النوع | مطلوب | الوصف |
|---------|-------|-------|-------|
| `code` | string | نعم | كود Python المراد تنفيذه |

## سيناريوهات الاستخدام

**مناسب للاستخدام:**
- تنفيذ الكود في بيئة Jupyter notebook
- اختبار مقتطفات الكود
- تحليل البيانات والحسابات

**غير مناسب للاستخدام:**
- تنفيذ الكود خارج بيئة Jupyter — يجب استخدام Bash
- تعديل الملفات — يجب استخدام Edit أو Write

## ملاحظات

- هذه أداة MCP (Model Context Protocol)، مقدمة من تكامل IDE
- يُنفذ الكود في Jupyter kernel الحالي، والحالة تستمر بين الاستدعاءات
- ما لم يطلب المستخدم صراحة، يجب تجنب تعريف المتغيرات أو تعديل حالة kernel
- تُفقد الحالة بعد إعادة تشغيل kernel

## الأهمية في cc-viewer

executeCode هي أداة MCP، تظهر في مصفوفة `tools` في سجل الطلبات باسم `mcp__ide__executeCode`. استدعاؤها ونتائجها تتبع نمط `tool_use` / `tool_result` القياسي. إضافة أو إزالة أدوات MCP تؤدي إلى تغيير مصفوفة tools، مما قد يؤدي إلى إعادة بناء الذاكرة المؤقتة.

## النص الأصلي

<textarea readonly>Execute python code in the Jupyter kernel for the current notebook file.
    
    All code will be executed in the current Jupyter kernel.
    
    Avoid declaring variables or modifying the state of the kernel unless the user
    explicitly asks for it.
    
    Any code executed will persist across calls to this tool, unless the kernel
    has been restarted.</textarea>
