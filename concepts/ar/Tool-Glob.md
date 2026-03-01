# Glob

## التعريف

أداة سريعة لمطابقة أنماط أسماء الملفات، تدعم قواعد الكود بأي حجم. تُرجع مسارات الملفات المطابقة مرتبة حسب وقت التعديل.

## المعاملات

| المعامل | النوع | مطلوب | الوصف |
|---------|-------|-------|-------|
| `pattern` | string | نعم | نمط glob (مثل `**/*.js`، `src/**/*.ts`) |
| `path` | string | لا | دليل البحث، الافتراضي هو دليل العمل الحالي. لا تمرر "undefined" أو "null" |

## سيناريوهات الاستخدام

**مناسب للاستخدام:**
- البحث عن الملفات بنمط اسم الملف
- البحث عن جميع الملفات من نوع معين (مثل جميع ملفات `.tsx`)
- تحديد موقع الملفات عند البحث عن تعريف فئة معينة (مثل `class Foo`)
- يمكن إطلاق عدة استدعاءات Glob بالتوازي في رسالة واحدة

**غير مناسب للاستخدام:**
- البحث في محتوى الملفات — يجب استخدام Grep
- الاستكشاف المفتوح الذي يتطلب جولات بحث متعددة — يجب استخدام Task (نوع Explore)

## ملاحظات

- يدعم صيغة glob القياسية: `*` يطابق مستوى واحد، `**` يطابق مستويات متعددة، `{}` يطابق خيارات متعددة
- النتائج مرتبة حسب وقت التعديل
- يُفضل استخدامه على أمر `find` في Bash

## الأهمية في cc-viewer

يظهر استدعاء Glob في سجل الطلبات كزوج من كتل محتوى `tool_use` / `tool_result`. يحتوي `tool_result` على قائمة مسارات الملفات المطابقة.

## النص الأصلي

<textarea readonly>- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead
- You can call multiple tools in a single response. It is always better to speculatively perform multiple searches in parallel if they are potentially useful.</textarea>
