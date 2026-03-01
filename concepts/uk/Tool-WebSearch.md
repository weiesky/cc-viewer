# WebSearch

## Визначення

Виконує запит до пошукової системи та повертає результати пошуку для отримання актуальної інформації.

## Параметри

| Параметр | Тип | Обов'язковий | Опис |
|----------|-----|--------------|------|
| `query` | string | Так | Пошуковий запит (мінімум 2 символи) |
| `allowed_domains` | string[] | Ні | Включати результати лише з цих доменів |
| `blocked_domains` | string[] | Ні | Виключити результати з цих доменів |

## Сценарії використання

**Підходить для:**
- Отримання актуальної інформації, що виходить за межі дати відсічення знань моделі
- Пошук поточних подій та найновіших даних
- Пошук найактуальнішої технічної документації

## Примітки

- Результати пошуку повертаються у форматі markdown-гіперпосилань
- Після використання обов'язково додайте розділ "Sources:" в кінці відповіді зі списком відповідних URL
- Підтримує фільтрацію за доменами (включення/виключення)
- У пошуковому запиті слід використовувати поточний рік
- Доступний лише в США

## Значення в cc-viewer

Виклики WebSearch відображаються в журналі запитів як пара content block `tool_use` / `tool_result`. `tool_result` містить список результатів пошуку.

## Оригінальний текст

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
