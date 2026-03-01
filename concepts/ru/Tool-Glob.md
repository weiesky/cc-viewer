# Glob

## Определение

Быстрый инструмент сопоставления шаблонов имён файлов, поддерживающий кодовые базы любого размера. Возвращает совпавшие пути файлов, отсортированные по времени модификации.

## Параметры

| Параметр | Тип | Обязательный | Описание |
|------|------|------|------|
| `pattern` | string | Да | Шаблон glob (например, `**/*.js`, `src/**/*.ts`) |
| `path` | string | Нет | Каталог поиска, по умолчанию текущий рабочий каталог. Не передавайте "undefined" или "null" |

## Сценарии использования

**Подходящее применение:**
- Поиск файлов по шаблону имени
- Поиск всех файлов определённого типа (например, всех файлов `.tsx`)
- Локализация файлов при поиске определения класса (например, `class Foo`)
- Можно параллельно отправлять несколько вызовов Glob в одном сообщении

**Неподходящее применение:**
- Поиск содержимого файлов — следует использовать Grep
- Открытое исследование, требующее нескольких раундов поиска — следует использовать Task (тип Explore)

## Примечания

- Поддерживает стандартный синтаксис glob: `*` соответствует одному уровню, `**` — нескольким уровням, `{}` — множественному выбору
- Результаты отсортированы по времени модификации
- Более рекомендуется, чем команда `find` в Bash

## Значение в cc-viewer

Вызовы Glob в логах запросов отображаются как пары блоков content `tool_use` / `tool_result`. `tool_result` содержит список совпавших путей файлов.

## Оригинальный текст

<textarea readonly>- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead
- You can call multiple tools in a single response. It is always better to speculatively perform multiple searches in parallel if they are potentially useful.</textarea>
