# WebSearch

## Определение

Выполняет запрос к поисковой системе, возвращая результаты поиска для получения актуальной информации.

## Параметры

| Параметр | Тип | Обязательный | Описание |
|------|------|------|------|
| `query` | string | Да | Поисковый запрос (минимум 2 символа) |
| `allowed_domains` | string[] | Нет | Включать только результаты с этих доменов |
| `blocked_domains` | string[] | Нет | Исключать результаты с этих доменов |

## Сценарии использования

**Подходящее применение:**
- Получение актуальной информации за пределами даты отсечки знаний модели
- Поиск текущих событий и последних данных
- Поиск новейшей технической документации

## Примечания

- Результаты поиска возвращаются в формате гиперссылок markdown
- После использования необходимо добавить раздел "Sources:" в конце ответа со списком соответствующих URL
- Поддерживает фильтрацию доменов (включение/исключение)
- В поисковых запросах следует использовать текущий год
- Доступно только в США

## Значение в cc-viewer

Вызовы WebSearch в логах запросов отображаются как пары блоков content `tool_use` / `tool_result`. `tool_result` содержит список результатов поиска.

## Оригинальный текст

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
