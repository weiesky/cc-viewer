# Write

## Визначення

Записує вміст у локальну файлову систему. Якщо файл вже існує, перезаписує його.

## Параметри

| Параметр | Тип | Обов'язковий | Опис |
|----------|-----|--------------|------|
| `file_path` | string | Так | Абсолютний шлях до файлу (повинен бути абсолютним) |
| `content` | string | Так | Вміст для запису |

## Сценарії використання

**Підходить для:**
- Створення нових файлів
- Коли потрібно повністю переписати вміст файлу

**Не підходить для:**
- Зміна локальної частини файлу — слід використовувати Edit
- Не слід проактивно створювати файли документації (*.md) або README, якщо користувач явно не просить

## Примітки

- Якщо цільовий файл вже існує, його потрібно спочатку прочитати через Read, інакше буде помилка
- Перезаписує весь вміст існуючого файлу
- Надавайте перевагу Edit для редагування існуючих файлів; Write використовується лише для створення нових файлів або повного перезапису

## Значення в cc-viewer

Виклики Write відображаються в журналі запитів як `tool_use` content block, де `input.content` містить повний записаний вміст.

## Оригінальний текст

<textarea readonly>Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.</textarea>
