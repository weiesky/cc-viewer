# Read

## Определение

Читает содержимое файла из локальной файловой системы. Поддерживает текстовые файлы, изображения, PDF и Jupyter notebook.

## Параметры

| Параметр | Тип | Обязательный | Описание |
|------|------|------|------|
| `file_path` | string | Да | Абсолютный путь к файлу |
| `offset` | number | Нет | Номер начальной строки (для сегментного чтения больших файлов) |
| `limit` | number | Нет | Количество строк для чтения (для сегментного чтения больших файлов) |
| `pages` | string | Нет | Диапазон страниц PDF (например, "1-5", "3", "10-20"), применимо только к PDF |

## Сценарии использования

**Подходящее применение:**
- Чтение файлов кода, конфигурационных файлов и других текстовых файлов
- Просмотр файлов изображений (Claude — мультимодальная модель)
- Чтение PDF-документов
- Чтение Jupyter notebook (возвращает все ячейки с выводом)
- Параллельное чтение нескольких файлов для получения контекста

**Неподходящее применение:**
- Чтение каталогов — следует использовать команду `ls` в Bash
- Открытое исследование кодовой базы — следует использовать Task (тип Explore)

## Примечания

- Путь должен быть абсолютным, не относительным
- По умолчанию читает первые 2000 строк файла
- Строки длиннее 2000 символов будут обрезаны
- Вывод использует формат `cat -n`, нумерация строк начинается с 1
- Большие PDF (более 10 страниц) должны иметь указанный параметр `pages`, максимум 20 страниц за раз
- Чтение несуществующего файла вернёт ошибку (не вызовет сбой)
- Можно параллельно вызывать несколько Read в одном сообщении

## Значение в cc-viewer

Вызовы Read в логах запросов отображаются как пары блоков content `tool_use` (вызов) и `tool_result` (возвращённое содержимое). `tool_result` содержит фактическое содержимое файла, что позволяет анализировать, какие файлы модель прочитала.

## Оригинальный текст

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
