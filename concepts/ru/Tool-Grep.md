# Grep

## Определение

Мощный инструмент поиска по содержимому на основе ripgrep. Поддерживает регулярные выражения, фильтрацию по типам файлов и несколько режимов вывода.

## Параметры

| Параметр | Тип | Обязательный | Описание |
|------|------|------|------|
| `pattern` | string | Да | Шаблон поиска регулярного выражения |
| `path` | string | Нет | Путь поиска (файл или каталог), по умолчанию текущий рабочий каталог |
| `glob` | string | Нет | Фильтр имён файлов (например, `*.js`, `*.{ts,tsx}`) |
| `type` | string | Нет | Фильтр типа файла (например, `js`, `py`, `rust`), эффективнее чем glob |
| `output_mode` | enum | Нет | Режим вывода: `files_with_matches` (по умолчанию), `content`, `count` |
| `-i` | boolean | Нет | Поиск без учёта регистра |
| `-n` | boolean | Нет | Отображение номеров строк (только режим content), по умолчанию true |
| `-A` | number | Нет | Количество строк, отображаемых после совпадения |
| `-B` | number | Нет | Количество строк, отображаемых перед совпадением |
| `-C` / `context` | number | Нет | Количество строк, отображаемых до и после совпадения |
| `head_limit` | number | Нет | Лимит количества результатов, по умолчанию 0 (без лимита) |
| `offset` | number | Нет | Пропуск первых N результатов |
| `multiline` | boolean | Нет | Включение многострочного режима сопоставления, по умолчанию false |

## Сценарии использования

**Подходящее применение:**
- Поиск определённых строк или шаблонов в кодовой базе
- Нахождение мест использования функций/переменных
- Фильтрация результатов поиска по типу файла
- Подсчёт совпадений

**Неподходящее применение:**
- Поиск файлов по имени — следует использовать Glob
- Открытое исследование, требующее нескольких раундов поиска — следует использовать Task (тип Explore)

## Примечания

- Использует синтаксис ripgrep (не grep), специальные символы вроде фигурных скобок требуют экранирования
- Режим `files_with_matches` возвращает только пути файлов, наиболее эффективный
- Режим `content` возвращает содержимое совпавших строк, поддерживает контекстные строки
- Многострочное сопоставление требует установки `multiline: true`
- Всегда предпочитайте инструмент Grep вместо команд `grep` или `rg` в Bash

## Значение в cc-viewer

Вызовы Grep в логах запросов отображаются как пары блоков content `tool_use` / `tool_result`. `tool_result` содержит результаты поиска.

## Оригинальный текст

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
