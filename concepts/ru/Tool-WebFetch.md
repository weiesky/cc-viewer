# WebFetch

## Определение

Получает содержимое веб-страницы по указанному URL, конвертирует HTML в markdown и обрабатывает содержимое с помощью AI-модели согласно prompt.

## Параметры

| Параметр | Тип | Обязательный | Описание |
|------|------|------|------|
| `url` | string (URI) | Да | Полный URL для получения |
| `prompt` | string | Да | Описание информации для извлечения со страницы |

## Сценарии использования

**Подходящее применение:**
- Получение содержимого публичных веб-страниц
- Просмотр онлайн-документации
- Извлечение определённой информации с веб-страниц

**Неподходящее применение:**
- URL, требующие аутентификации (Google Docs, Confluence, Jira, GitHub и т.д.) — сначала поищите специализированный инструмент MCP
- URL GitHub — предпочитайте использование `gh` CLI

## Примечания

- URL должен быть полным, валидным URL
- HTTP автоматически обновляется до HTTPS
- Слишком большое содержимое может быть сокращено
- Включает 15-минутный самоочищающийся кеш
- Когда URL перенаправляет на другой хост, инструмент возвращает URL перенаправления — необходимо повторить запрос с новым URL
- Если доступен инструмент web fetch, предоставляемый MCP, предпочитайте его использование

## Значение в cc-viewer

Вызовы WebFetch в логах запросов отображаются как пары блоков content `tool_use` / `tool_result`. `tool_result` содержит резюме содержимого страницы, обработанное AI.

## Оригинальный текст

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
