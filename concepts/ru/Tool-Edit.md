# Edit

## Определение

Редактирует файл через точную замену строк. Заменяет `old_string` в файле на `new_string`.

## Параметры

| Параметр | Тип | Обязательный | Описание |
|------|------|------|------|
| `file_path` | string | Да | Абсолютный путь к файлу для модификации |
| `old_string` | string | Да | Исходный текст для замены |
| `new_string` | string | Да | Новый текст после замены (должен отличаться от old_string) |
| `replace_all` | boolean | Нет | Заменять ли все вхождения, по умолчанию `false` |

## Сценарии использования

**Подходящее применение:**
- Модификация определённых фрагментов кода в существующих файлах
- Исправление ошибок, обновление логики
- Переименование переменных (в сочетании с `replace_all: true`)
- Любой сценарий, требующий точной модификации содержимого файла

**Неподходящее применение:**
- Создание новых файлов — следует использовать Write
- Масштабное переписывание — может потребоваться Write для перезаписи всего файла

## Примечания

- Перед использованием необходимо сначала прочитать файл через Read, иначе возникнет ошибка
- `old_string` должен быть уникальным в файле, иначе редактирование не удастся. Если не уникален, нужно предоставить больше контекста или использовать `replace_all`
- При редактировании текста необходимо сохранять оригинальные отступы (tab/пробелы), не включать префиксы номеров строк из вывода Read
- Предпочтительно редактировать существующие файлы, а не создавать новые
- `new_string` должен отличаться от `old_string`

## Значение в cc-viewer

Вызов Edit в логах запросов отображается как блок content `tool_use`, чей `input` содержит `old_string` и `new_string`, что позволяет отслеживать, какие модификации модель внесла в файл.

## Оригинальный текст

<textarea readonly>Performs exact string replacements in files.

Usage:
- You must use your `Read` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file. 
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if `old_string` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use `replace_all` to change every instance of `old_string`.
- Use `replace_all` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.</textarea>
