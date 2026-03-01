# Write

## التعريف

كتابة المحتوى إلى نظام الملفات المحلي. إذا كان الملف موجوداً بالفعل فسيتم الكتابة فوقه.

## المعاملات

| المعامل | النوع | مطلوب | الوصف |
|---------|-------|-------|-------|
| `file_path` | string | نعم | المسار المطلق للملف (يجب أن يكون مسار مطلق) |
| `content` | string | نعم | المحتوى المراد كتابته |

## سيناريوهات الاستخدام

**مناسب للاستخدام:**
- إنشاء ملفات جديدة
- عند الحاجة لإعادة كتابة محتوى الملف بالكامل

**غير مناسب للاستخدام:**
- تعديل محتوى جزئي في الملف — يجب استخدام Edit
- لا ينبغي إنشاء ملفات توثيق (*.md) أو README بشكل استباقي، إلا إذا طلب المستخدم ذلك صراحة

## ملاحظات

- إذا كان الملف الهدف موجوداً بالفعل، يجب قراءته أولاً عبر Read وإلا سيفشل
- يكتب فوق كامل محتوى الملف الموجود
- يُفضل استخدام Edit لتحرير الملفات الموجودة، Write فقط لإنشاء ملفات جديدة أو إعادة الكتابة الكاملة

## الأهمية في cc-viewer

يظهر استدعاء Write في سجل الطلبات ككتلة محتوى `tool_use`، حيث يحتوي `input.content` على المحتوى الكامل المكتوب.

## النص الأصلي

<textarea readonly>Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.</textarea>
