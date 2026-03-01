# WebSearch

## التعريف

تنفيذ استعلامات محرك البحث، وإرجاع نتائج البحث للحصول على أحدث المعلومات.

## المعاملات

| المعامل | النوع | مطلوب | الوصف |
|---------|-------|-------|-------|
| `query` | string | نعم | استعلام البحث (حرفان على الأقل) |
| `allowed_domains` | string[] | لا | تضمين نتائج من هذه النطاقات فقط |
| `blocked_domains` | string[] | لا | استبعاد نتائج من هذه النطاقات |

## سيناريوهات الاستخدام

**مناسب للاستخدام:**
- الحصول على أحدث المعلومات التي تتجاوز تاريخ قطع معرفة النموذج
- البحث عن الأحداث الجارية وأحدث البيانات
- البحث عن أحدث التوثيق التقني

## ملاحظات

- تُرجع نتائج البحث بتنسيق روابط markdown
- بعد الاستخدام يجب إضافة قسم "Sources:" في نهاية الاستجابة مع قائمة عناوين URL ذات الصلة
- يدعم تصفية النطاقات (تضمين/استبعاد)
- يجب استخدام السنة الحالية في استعلامات البحث
- متاح فقط في الولايات المتحدة

## الأهمية في cc-viewer

يظهر استدعاء WebSearch في سجل الطلبات كزوج من كتل محتوى `tool_use` / `tool_result`. يحتوي `tool_result` على قائمة نتائج البحث.

## النص الأصلي

<textarea readonly>
- Allows Claude to search the web and use the results to inform responses
- Provides up-to-date information for current events and recent data
- Returns search result information formatted as search result blocks, including links as markdown hyperlinks
- Use this tool for accessing information beyond Claude's knowledge cutoff
- Searches are performed automatically within a single API call

CRITICAL REQUIREMENT - You MUST follow this:
  - After answering the user's question, you MUST include a "Sources:" section at the end of your response
  - In the Sources section, list all relevant URLs from the search results as markdown hyperlinks: [Title](URL)
  - This is MANDATORY - never skip including sources in your response
  - Example format:

    [Your answer here]

    Sources:
    - [Source Title 1](https://example.com/1)
    - [Source Title 2](https://example.com/2)

Usage notes:
  - Domain filtering is supported to include or block specific websites
  - Web search is only available in the US

IMPORTANT - Use the correct year in search queries:
  - The current month is March 2026. You MUST use this year when searching for recent information, documentation, or current events.
  - Example: If the user asks for "latest React docs", search for "React documentation" with the current year, NOT last year
</textarea>
