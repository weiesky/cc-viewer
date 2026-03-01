# Glob

## Визначення

Швидкий інструмент зіставлення шаблонів імен файлів, що підтримує кодові бази будь-якого розміру. Повертає шляхи файлів, що збіглися, відсортовані за часом модифікації.

## Параметри

| Параметр | Тип | Обов'язковий | Опис |
|----------|-----|--------------|------|
| `pattern` | string | Так | Шаблон glob (наприклад, `**/*.js`, `src/**/*.ts`) |
| `path` | string | Ні | Каталог пошуку, за замовчуванням поточний робочий каталог. Не передавайте "undefined" або "null" |

## Сценарії використання

**Підходить для:**
- Пошук файлів за шаблоном імені файлу
- Пошук усіх файлів певного типу (наприклад, усіх файлів `.tsx`)
- Локалізація файлу при пошуку конкретного визначення класу (наприклад, `class Foo`)
- Можна паралельно запускати кілька викликів Glob в одному повідомленні

**Не підходить для:**
- Пошук вмісту файлів — слід використовувати Grep
- Відкрите дослідження, що потребує кількох раундів — слід використовувати Task (тип Explore)

## Примітки

- Підтримує стандартний синтаксис glob: `*` збігається з одним рівнем, `**` з кількома рівнями, `{}` для множинного вибору
- Результати відсортовані за часом модифікації
- Рекомендується більше, ніж команда `find` у Bash

## Значення в cc-viewer

Виклики Glob відображаються в журналі запитів як пара content block `tool_use` / `tool_result`. `tool_result` містить список шляхів файлів, що збіглися.

## Оригінальний текст

<textarea readonly>- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead
- You can call multiple tools in a single response. It is always better to speculatively perform multiple searches in parallel if they are potentially useful.</textarea>
