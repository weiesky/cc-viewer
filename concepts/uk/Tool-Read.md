# Read

## Визначення

Читає вміст файлу з локальної файлової системи. Підтримує текстові файли, зображення, PDF та Jupyter notebook.

## Параметри

| Параметр | Тип | Обов'язковий | Опис |
|----------|-----|--------------|------|
| `file_path` | string | Так | Абсолютний шлях до файлу |
| `offset` | number | Ні | Початковий номер рядка (для посегментного читання великих файлів) |
| `limit` | number | Ні | Кількість рядків для читання (для посегментного читання великих файлів) |
| `pages` | string | Ні | Діапазон сторінок PDF (наприклад, "1-5", "3", "10-20"), лише для PDF |

## Сценарії використання

**Підходить для:**
- Читання текстових файлів: файлів коду, конфігураційних файлів тощо
- Перегляд файлів зображень (Claude — мультимодальна модель)
- Читання PDF-документів
- Читання Jupyter notebook (повертає всі комірки та їх вивід)
- Паралельне читання кількох файлів для отримання контексту

**Не підходить для:**
- Читання каталогу — слід використовувати команду `ls` у Bash
- Відкрите дослідження кодової бази — слід використовувати Task (тип Explore)

## Примітки

- Шлях повинен бути абсолютним, не відносним
- За замовчуванням читає перші 2000 рядків файлу
- Рядки довші за 2000 символів будуть обрізані
- Вивід у форматі `cat -n`, нумерація рядків починається з 1
- Для великих PDF (понад 10 сторінок) обов'язково вказувати параметр `pages`, максимум 20 сторінок за раз
- Читання неіснуючого файлу поверне помилку (не призведе до збою)
- Можна паралельно викликати кілька Read в одному повідомленні

## Значення в cc-viewer

Виклики Read відображаються в журналі запитів як пара content block `tool_use` (виклик) та `tool_result` (повернений вміст). `tool_result` містить фактичний вміст файлу і може використовуватися для аналізу того, які файли модель прочитала.

## Оригінальний текст

<textarea readonly>Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to 2000 lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters
- Any lines longer than 2000 characters will be truncated
- Results are returned using cat -n format, with line numbers starting at 1
- This tool allows Claude Code to read images (eg PNG, JPG, etc). When reading an image file the contents are presented visually as Claude Code is a multimodal LLM.
- This tool can read PDF files (.pdf). For large PDFs (more than 10 pages), you MUST provide the pages parameter to read specific page ranges (e.g., pages: "1-5"). Reading a large PDF without the pages parameter will fail. Maximum 20 pages per request.
- This tool can read Jupyter notebooks (.ipynb files) and returns all cells with their outputs, combining code, text, and visualizations.
- This tool can only read files, not directories. To read a directory, use an ls command via the Bash tool.
- You can call multiple tools in a single response. It is always better to speculatively read multiple potentially useful files in parallel.
- You will regularly be asked to read screenshots. If the user provides a path to a screenshot, ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.</textarea>
