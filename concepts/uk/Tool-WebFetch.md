# WebFetch

## Визначення

Отримує вміст веб-сторінки за вказаним URL, конвертує HTML у markdown та обробляє вміст за допомогою AI-моделі відповідно до prompt.

## Параметри

| Параметр | Тип | Обов'язковий | Опис |
|----------|-----|--------------|------|
| `url` | string (URI) | Так | Повний URL для отримання |
| `prompt` | string | Так | Описує, яку інформацію потрібно витягти зі сторінки |

## Сценарії використання

**Підходить для:**
- Отримання вмісту публічних веб-сторінок
- Перегляд онлайн-документації
- Витягування конкретної інформації з веб-сторінки

**Не підходить для:**
- URL, що потребують автентифікації (Google Docs, Confluence, Jira, GitHub тощо) — спочатку шукайте спеціалізований MCP-інструмент
- URL GitHub — пріоритетно використовуйте `gh` CLI

## Примітки

- URL повинен бути повним дійсним URL
- HTTP автоматично оновлюється до HTTPS
- При занадто великому вмісті результати можуть бути зведені
- Містить 15-хвилинний кеш з автоочищенням
- Коли URL перенаправляє на інший хост, інструмент повертає URL перенаправлення, і потрібно зробити новий запит з новим URL
- Якщо доступний MCP-інструмент web fetch, надавайте йому перевагу

## Значення в cc-viewer

Виклики WebFetch відображаються в журналі запитів як пара content block `tool_use` / `tool_result`. `tool_result` містить зведення вмісту веб-сторінки, обробленого AI.

## Оригінальний текст

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
