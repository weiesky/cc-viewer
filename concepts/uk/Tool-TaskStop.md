# TaskStop

## Визначення

Зупиняє фонове завдання, що виконується.

## Параметри

| Параметр | Тип | Обов'язковий | Опис |
|----------|-----|--------------|------|
| `task_id` | string | Ні | ID фонового завдання для зупинки |
| `shell_id` | string | Ні | Застаріло, використовуйте `task_id` |

## Сценарії використання

**Підходить для:**
- Завершення довготривалих завдань, які більше не потрібні
- Скасування помилково запущених фонових завдань

## Примітки

- Повертає статус успіху або невдачі
- Параметр `shell_id` застарів, слід використовувати `task_id`

## Значення в cc-viewer

Виклик TaskStop сам по собі не генерує API-запиту; це внутрішня операція управління завданнями Claude Code.

## Оригінальний текст

<textarea readonly>
- Stops a running background task by its ID
- Takes a task_id parameter identifying the task to stop
- Returns a success or failure status
- Use this tool when you need to terminate a long-running task
</textarea>
