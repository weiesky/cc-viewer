# WebFetch

## التعريف

جلب محتوى صفحة ويب من عنوان URL محدد، وتحويل HTML إلى markdown، ومعالجة المحتوى باستخدام نموذج ذكاء اصطناعي وفقاً للـ prompt.

## المعاملات

| المعامل | النوع | مطلوب | الوصف |
|---------|-------|-------|-------|
| `url` | string (URI) | نعم | عنوان URL الكامل المراد جلبه |
| `prompt` | string | نعم | وصف المعلومات المراد استخلاصها من الصفحة |

## سيناريوهات الاستخدام

**مناسب للاستخدام:**
- الحصول على محتوى صفحات الويب العامة
- الاطلاع على التوثيق عبر الإنترنت
- استخلاص معلومات محددة من صفحات الويب

**غير مناسب للاستخدام:**
- عناوين URL التي تتطلب مصادقة (Google Docs، Confluence، Jira، GitHub إلخ) — يجب البحث أولاً عن أداة MCP مخصصة
- عناوين GitHub URL — يُفضل استخدام `gh` CLI

## ملاحظات

- يجب أن يكون URL كاملاً وصالحاً
- يتم ترقية HTTP تلقائياً إلى HTTPS
- قد يتم تلخيص النتائج عندما يكون المحتوى كبيراً جداً
- يتضمن ذاكرة مؤقتة ذاتية التنظيف مدتها 15 دقيقة
- عند إعادة توجيه URL إلى مضيف مختلف، تُرجع الأداة عنوان URL المُعاد توجيهه ويجب إعادة الطلب بالعنوان الجديد
- إذا كانت أداة web fetch مقدمة من MCP متاحة، يُفضل استخدامها

## الأهمية في cc-viewer

يظهر استدعاء WebFetch في سجل الطلبات كزوج من كتل محتوى `tool_use` / `tool_result`. يحتوي `tool_result` على ملخص محتوى صفحة الويب المعالج بالذكاء الاصطناعي.

## النص الأصلي

<textarea readonly>IMPORTANT: WebFetch WILL FAIL for authenticated or private URLs. Before using this tool, check if the URL points to an authenticated service (e.g. Google Docs, Confluence, Jira, GitHub). If so, you MUST use ToolSearch first to find a specialized tool that provides authenticated access.

- Fetches content from a specified URL and processes it using an AI model
- Takes a URL and a prompt as input
- Fetches the URL content, converts HTML to markdown
- Processes the content with the prompt using a small, fast model
- Returns the model's response about the content
- Use this tool when you need to retrieve and analyze web content

Usage notes:
  - IMPORTANT: If an MCP-provided web fetch tool is available, prefer using that tool instead of this one, as it may have fewer restrictions.
  - The URL must be a fully-formed valid URL
  - HTTP URLs will be automatically upgraded to HTTPS
  - The prompt should describe what information you want to extract from the page
  - This tool is read-only and does not modify any files
  - Results may be summarized if the content is very large
  - Includes a self-cleaning 15-minute cache for faster responses when repeatedly accessing the same URL
  - When a URL redirects to a different host, the tool will inform you and provide the redirect URL in a special format. You should then make a new WebFetch request with the redirect URL to fetch the content.
  - For GitHub URLs, prefer using the gh CLI via Bash instead (e.g., gh pr view, gh issue view, gh api).
</textarea>
