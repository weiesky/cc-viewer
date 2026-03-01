# TaskGet

## Определение

Получает полные детали задачи по её ID.

## Параметры

| Параметр | Тип | Обязательный | Описание |
|------|------|------|------|
| `taskId` | string | Да | ID задачи для получения |

## Возвращаемое содержимое

- `subject` — заголовок задачи
- `description` — подробные требования и контекст
- `status` — статус: `pending`, `in_progress` или `completed`
- `blocks` — список задач, заблокированных этой задачей
- `blockedBy` — список предшествующих задач, блокирующих эту задачу

## Сценарии использования

**Подходящее применение:**
- Получение полного описания и контекста задачи перед началом работы
- Понимание зависимостей задачи
- Получение полных требований после назначения задачи

## Примечания

- После получения задачи следует проверить, пуст ли список `blockedBy`, прежде чем начинать работу
- Используйте TaskList для просмотра сводки всех задач

## Значение в cc-viewer

TaskGet — это внутренняя операция управления задачами, не порождающая независимого API-запроса.

## Оригинальный текст

<textarea readonly>Use this tool to retrieve a task by its ID from the task list.

## When to Use This Tool

- When you need the full description and context before starting work on a task
- To understand task dependencies (what it blocks, what blocks it)
- After being assigned a task, to get complete requirements

## Output

Returns full task details:
- **subject**: Task title
- **description**: Detailed requirements and context
- **status**: 'pending', 'in_progress', or 'completed'
- **blocks**: Tasks waiting on this one to complete
- **blockedBy**: Tasks that must complete before this one can start

## Tips

- After fetching a task, verify its blockedBy list is empty before beginning work.
- Use TaskList to see all tasks in summary form.
</textarea>
