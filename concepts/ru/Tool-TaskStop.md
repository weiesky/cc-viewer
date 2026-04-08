# TaskStop

## Определение

Останавливает работающую фоновую задачу.

## Параметры

| Параметр | Тип | Обязательный | Описание |
|------|------|------|------|
| `task_id` | string | Нет | ID фоновой задачи для остановки |
| `shell_id` | string | Нет | Устарел, используйте `task_id` вместо этого |

## Сценарии использования

**Подходящее применение:**
- Завершение долго работающей задачи, которая больше не нужна
- Отмена ошибочно запущенной фоновой задачи

## Примечания

- Возвращает статус успеха или неудачи
- Параметр `shell_id` устарел, следует использовать `task_id`

## Оригинальный текст

<textarea readonly>
- Stops a running background task by its ID
- Takes a task_id parameter identifying the task to stop
- Returns a success or failure status
- Use this tool when you need to terminate a long-running task
</textarea>
