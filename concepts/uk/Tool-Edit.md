# Edit

## Визначення

Редагує файл через точну заміну рядків. Замінює `old_string` на `new_string` у файлі.

## Параметри

| Параметр | Тип | Обов'язковий | Опис |
|----------|-----|--------------|------|
| `file_path` | string | Так | Абсолютний шлях до файлу для зміни |
| `old_string` | string | Так | Оригінальний текст для заміни |
| `new_string` | string | Так | Новий текст після заміни (повинен відрізнятися від old_string) |
| `replace_all` | boolean | Ні | Чи замінювати всі збіги, за замовчуванням `false` |

## Сценарії використання

**Підходить для:**
- Зміна конкретних ділянок коду в існуючому файлі
- Виправлення помилок, оновлення логіки
- Перейменування змінних (у поєднанні з `replace_all: true`)
- Будь-які сценарії, що потребують точної зміни вмісту файлу

**Не підходить для:**
- Створення нових файлів — слід використовувати Write
- Масштабне переписування — може знадобитися Write для перезапису всього файлу

## Примітки

- Перед використанням файл повинен бути прочитаний через Read, інакше буде помилка
- `old_string` повинен бути унікальним у файлі, інакше редагування не вдасться. Якщо не унікальний, надайте більше контексту для забезпечення унікальності або використовуйте `replace_all`
- При редагуванні тексту необхідно зберігати оригінальний відступ (tab/пробіли), не включайте префікс номера рядка з виводу Read
- Надавайте перевагу редагуванню існуючих файлів, а не створенню нових
- `new_string` повинен відрізнятися від `old_string`

## Значення в cc-viewer

Виклики Edit відображаються в журналі запитів як `tool_use` content block, де `input` містить `old_string` та `new_string`, що дозволяє відстежувати, які зміни модель внесла до файлу.

## Оригінальний текст

<textarea readonly>Performs exact string replacements in files.

Usage:
- You must use your `Read` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file. 
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if `old_string` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use `replace_all` to change every instance of `old_string`.
- Use `replace_all` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.</textarea>
