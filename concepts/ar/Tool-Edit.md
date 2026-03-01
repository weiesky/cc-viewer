# Edit

## التعريف

تحرير الملفات عبر استبدال نصي دقيق. يستبدل `old_string` بـ `new_string` في الملف.

## المعاملات

| المعامل | النوع | مطلوب | الوصف |
|---------|-------|-------|-------|
| `file_path` | string | نعم | المسار المطلق للملف المراد تعديله |
| `old_string` | string | نعم | النص الأصلي المراد استبداله |
| `new_string` | string | نعم | النص الجديد بعد الاستبدال (يجب أن يختلف عن old_string) |
| `replace_all` | boolean | لا | هل يتم استبدال جميع التطابقات، الافتراضي `false` |

## سيناريوهات الاستخدام

**مناسب للاستخدام:**
- تعديل أجزاء محددة من الكود في ملفات موجودة
- إصلاح الأخطاء وتحديث المنطق
- إعادة تسمية المتغيرات (مع `replace_all: true`)
- أي سيناريو يتطلب تعديلاً دقيقاً لمحتوى الملف

**غير مناسب للاستخدام:**
- إنشاء ملفات جديدة — يجب استخدام Write
- إعادة كتابة واسعة النطاق — قد يتطلب Write للكتابة فوق الملف بالكامل

## ملاحظات

- يجب قراءة الملف أولاً عبر Read قبل الاستخدام، وإلا سيحدث خطأ
- يجب أن يكون `old_string` فريداً في الملف، وإلا يفشل التحرير. إذا لم يكن فريداً، يجب توفير مزيد من السياق لجعله فريداً، أو استخدام `replace_all`
- يجب الحفاظ على المسافة البادئة الأصلية (tab/مسافات) عند تحرير النص، ولا تُضمَّن بادئة أرقام الأسطر من مخرجات Read
- يُفضل تحرير الملفات الموجودة بدلاً من إنشاء ملفات جديدة
- يجب أن يختلف `new_string` عن `old_string`

## الأهمية في cc-viewer

يظهر استدعاء Edit في سجل الطلبات ككتلة محتوى `tool_use`، حيث يحتوي `input` على `old_string` و`new_string`، ويمكن استخدامه لتتبع التعديلات التي أجراها النموذج على الملفات.

## النص الأصلي

<textarea readonly>Performs exact string replacements in files.

Usage:
- You must use your `Read` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file. 
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if `old_string` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use `replace_all` to change every instance of `old_string`.
- Use `replace_all` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.</textarea>
