# Read

## التعريف

قراءة محتوى الملفات من نظام الملفات المحلي. يدعم الملفات النصية والصور وPDF وJupyter notebook.

## المعاملات

| المعامل | النوع | مطلوب | الوصف |
|---------|-------|-------|-------|
| `file_path` | string | نعم | المسار المطلق للملف |
| `offset` | number | لا | رقم سطر البداية (للقراءة المجزأة للملفات الكبيرة) |
| `limit` | number | لا | عدد الأسطر المقروءة (للقراءة المجزأة للملفات الكبيرة) |
| `pages` | string | لا | نطاق صفحات PDF (مثل "1-5"، "3"، "10-20")، ينطبق فقط على PDF |

## سيناريوهات الاستخدام

**مناسب للاستخدام:**
- قراءة ملفات الكود وملفات التكوين وغيرها من الملفات النصية
- عرض ملفات الصور (Claude نموذج متعدد الوسائط)
- قراءة مستندات PDF
- قراءة Jupyter notebook (يُرجع جميع الخلايا مع مخرجاتها)
- قراءة عدة ملفات بالتوازي للحصول على السياق

**غير مناسب للاستخدام:**
- قراءة الأدلة — يجب استخدام أمر `ls` في Bash
- استكشاف مفتوح لقاعدة الكود — يجب استخدام Task (نوع Explore)

## ملاحظات

- يجب أن يكون المسار مطلقاً وليس نسبياً
- يقرأ افتراضياً أول 2000 سطر من الملف
- الأسطر التي تتجاوز 2000 حرف يتم اقتطاعها
- المخرجات بتنسيق `cat -n`، أرقام الأسطر تبدأ من 1
- ملفات PDF الكبيرة (أكثر من 10 صفحات) يجب تحديد معامل `pages`، بحد أقصى 20 صفحة في كل مرة
- قراءة ملف غير موجود تُرجع خطأ (لا تتعطل)
- يمكن استدعاء عدة Read بالتوازي في رسالة واحدة

## الأهمية في cc-viewer

يظهر استدعاء Read في سجل الطلبات كزوج من كتل محتوى `tool_use` (الاستدعاء) و`tool_result` (المحتوى المُرجع). يحتوي `tool_result` على المحتوى الفعلي للملف، ويمكن استخدامه لتحليل الملفات التي قرأها النموذج.

## النص الأصلي

<textarea readonly>Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to 2000 lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters
- Any lines longer than 2000 characters will be truncated
- Results are returned using cat -n format, with line numbers starting at 1
- This tool allows Claude Code to read images (eg PNG, JPG, etc). When reading an image file the contents are presented visually as Claude Code is a multimodal LLM.
- This tool can read PDF files (.pdf). For large PDFs (more than 10 pages), you MUST provide the pages parameter to read specific page ranges (e.g., pages: "1-5"). Reading a large PDF without the pages parameter will fail. Maximum 20 pages per request.
- This tool can read Jupyter notebooks (.ipynb files) and returns all cells with their outputs, combining code, text, and visualizations.
- This tool can only read files, not directories. To read a directory, use an ls command via the Bash tool.
- You can call multiple tools in a single response. It is always better to speculatively read multiple potentially useful files in parallel.
- You will regularly be asked to read screenshots. If the user provides a path to a screenshot, ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.</textarea>
