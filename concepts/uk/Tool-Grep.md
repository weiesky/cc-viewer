# Grep

## Визначення

Потужний інструмент пошуку вмісту на основі ripgrep. Підтримує регулярні вирази, фільтрацію за типом файлу та кілька режимів виводу.

## Параметри

| Параметр | Тип | Обов'язковий | Опис |
|----------|-----|--------------|------|
| `pattern` | string | Так | Шаблон пошуку регулярного виразу |
| `path` | string | Ні | Шлях пошуку (файл або каталог), за замовчуванням поточний робочий каталог |
| `glob` | string | Ні | Фільтр імені файлу (наприклад, `*.js`, `*.{ts,tsx}`) |
| `type` | string | Ні | Фільтр типу файлу (наприклад, `js`, `py`, `rust`), ефективніший за glob |
| `output_mode` | enum | Ні | Режим виводу: `files_with_matches` (за замовчуванням), `content`, `count` |
| `-i` | boolean | Ні | Пошук без урахування регістру |
| `-n` | boolean | Ні | Показувати номери рядків (лише режим content), за замовчуванням true |
| `-A` | number | Ні | Кількість рядків після збігу |
| `-B` | number | Ні | Кількість рядків перед збігом |
| `-C` / `context` | number | Ні | Кількість рядків до та після збігу |
| `head_limit` | number | Ні | Обмеження кількості записів виводу, за замовчуванням 0 (без обмежень) |
| `offset` | number | Ні | Пропустити перші N результатів |
| `multiline` | boolean | Ні | Увімкнути багаторядковий режим зіставлення, за замовчуванням false |

## Сценарії використання

**Підходить для:**
- Пошук конкретних рядків або шаблонів у кодовій базі
- Пошук місць використання функцій/змінних
- Фільтрація результатів пошуку за типом файлу
- Підрахунок кількості збігів

**Не підходить для:**
- Пошук файлів за іменем — слід використовувати Glob
- Відкрите дослідження, що потребує кількох раундів — слід використовувати Task (тип Explore)

## Примітки

- Використовує синтаксис ripgrep (не grep), спеціальні символи як фігурні дужки потребують екранування
- Режим `files_with_matches` повертає лише шляхи файлів, найефективніший
- Режим `content` повертає вміст рядків зі збігами, підтримує контекстні рядки
- Для багаторядкового зіставлення потрібно встановити `multiline: true`
- Завжди надавайте перевагу інструменту Grep замість команд `grep` або `rg` у Bash

## Значення в cc-viewer

Виклики Grep відображаються в журналі запитів як пара content block `tool_use` / `tool_result`. `tool_result` містить результати пошуку.

## Оригінальний текст

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
