# Write

## Определение

Записывает содержимое в локальную файловую систему. Если файл уже существует, перезаписывает его.

## Параметры

| Параметр | Тип | Обязательный | Описание |
|------|------|------|------|
| `file_path` | string | Да | Абсолютный путь к файлу (должен быть абсолютным) |
| `content` | string | Да | Содержимое для записи |

## Сценарии использования

**Подходящее применение:**
- Создание новых файлов
- Когда требуется полная перезапись содержимого файла

**Неподходящее применение:**
- Модификация локального содержимого файла — следует использовать Edit
- Не следует проактивно создавать файлы документации (*.md) или README, если пользователь явно не просит

## Примечания

- Если целевой файл уже существует, его необходимо сначала прочитать через Read, иначе операция завершится ошибкой
- Перезаписывает всё содержимое существующего файла
- Предпочитайте Edit для редактирования существующих файлов, Write предназначен только для создания новых файлов или полной перезаписи

## Значение в cc-viewer

Вызов Write в логах запросов отображается как блок content `tool_use`, чей `input.content` содержит полное записанное содержимое.

## Оригинальный текст

<textarea readonly>Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.</textarea>
