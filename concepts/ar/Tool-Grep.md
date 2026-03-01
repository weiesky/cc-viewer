# Grep

## التعريف

أداة بحث قوية في المحتوى مبنية على ripgrep. تدعم التعبيرات النمطية وتصفية أنواع الملفات وأوضاع إخراج متعددة.

## المعاملات

| المعامل | النوع | مطلوب | الوصف |
|---------|-------|-------|-------|
| `pattern` | string | نعم | نمط بحث بتعبير نمطي |
| `path` | string | لا | مسار البحث (ملف أو دليل)، الافتراضي هو دليل العمل الحالي |
| `glob` | string | لا | تصفية أسماء الملفات (مثل `*.js`، `*.{ts,tsx}`) |
| `type` | string | لا | تصفية نوع الملف (مثل `js`، `py`، `rust`)، أكثر كفاءة من glob |
| `output_mode` | enum | لا | وضع الإخراج: `files_with_matches` (افتراضي)، `content`، `count` |
| `-i` | boolean | لا | بحث غير حساس لحالة الأحرف |
| `-n` | boolean | لا | عرض أرقام الأسطر (وضع content فقط)، الافتراضي true |
| `-A` | number | لا | عدد الأسطر المعروضة بعد التطابق |
| `-B` | number | لا | عدد الأسطر المعروضة قبل التطابق |
| `-C` / `context` | number | لا | عدد الأسطر المعروضة قبل وبعد التطابق |
| `head_limit` | number | لا | تحديد عدد نتائج الإخراج، الافتراضي 0 (بلا حدود) |
| `offset` | number | لا | تخطي أول N نتيجة |
| `multiline` | boolean | لا | تفعيل وضع المطابقة متعددة الأسطر، الافتراضي false |

## سيناريوهات الاستخدام

**مناسب للاستخدام:**
- البحث عن سلاسل نصية أو أنماط محددة في قاعدة الكود
- العثور على مواقع استخدام الدوال/المتغيرات
- تصفية نتائج البحث حسب نوع الملف
- إحصاء عدد التطابقات

**غير مناسب للاستخدام:**
- البحث عن الملفات بالاسم — يجب استخدام Glob
- الاستكشاف المفتوح الذي يتطلب جولات بحث متعددة — يجب استخدام Task (نوع Explore)

## ملاحظات

- يستخدم صيغة ripgrep (وليس grep)، الأحرف الخاصة مثل الأقواس المعقوفة تحتاج إلى تهريب
- وضع `files_with_matches` يُرجع مسارات الملفات فقط، وهو الأكثر كفاءة
- وضع `content` يُرجع محتوى الأسطر المطابقة، مع دعم أسطر السياق
- المطابقة متعددة الأسطر تتطلب تعيين `multiline: true`
- يُفضل دائماً استخدام أداة Grep بدلاً من أمر `grep` أو `rg` في Bash

## الأهمية في cc-viewer

يظهر استدعاء Grep في سجل الطلبات كزوج من كتل محتوى `tool_use` / `tool_result`. يحتوي `tool_result` على نتائج البحث.

## النص الأصلي

<textarea readonly>A powerful search tool built on ripgrep

  Usage:
  - ALWAYS use Grep for search tasks. NEVER invoke `grep` or `rg` as a Bash command. The Grep tool has been optimized for correct permissions and access.
  - Supports full regex syntax (e.g., "log.*Error", "function\s+\w+")
  - Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")
  - Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts
  - Use Agent tool for open-ended searches requiring multiple rounds
  - Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping (use `interface\{\}` to find `interface{}` in Go code)
  - Multiline matching: By default patterns match within single lines only. For cross-line patterns like `struct \{[\s\S]*?field`, use `multiline: true`
</textarea>
