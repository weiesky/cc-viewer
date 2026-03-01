# TaskList

## Определение

Отображает список всех задач в списке задач, позволяя просмотреть общий прогресс и доступную работу.

## Параметры

Без параметров.

## Возвращаемое содержимое

Сводка по каждой задаче:
- `id` — идентификатор задачи
- `subject` — краткое описание
- `status` — статус: `pending`, `in_progress` или `completed`
- `owner` — ответственный (ID агента), пустое означает не назначено
- `blockedBy` — список ID незавершённых задач, блокирующих эту задачу

## Сценарии использования

**Подходящее применение:**
- Просмотр доступных задач (статус pending, без owner, не заблокированы)
- Проверка общего прогресса проекта
- Поиск заблокированных задач
- Поиск следующей задачи после завершения текущей

## Примечания

- Предпочитайте обработку задач в порядке ID (наименьший ID первым), так как ранние задачи обычно предоставляют контекст для последующих
- Задачи с `blockedBy` не могут быть взяты до снятия зависимости
- Используйте TaskGet для получения полных деталей конкретной задачи

## Значение в cc-viewer

TaskList — это внутренняя операция управления задачами, не порождающая независимого API-запроса.

## Оригинальный текст

<textarea readonly>Use this tool to list all tasks in the task list.

## When to Use This Tool

- To see what tasks are available to work on (status: 'pending', no owner, not blocked)
- To check overall progress on the project
- To find tasks that are blocked and need dependencies resolved
- After completing a task, to check for newly unblocked work or claim the next available task
- **Prefer working on tasks in ID order** (lowest ID first) when multiple tasks are available, as earlier tasks often set up context for later ones

## Output

Returns a summary of each task:
- **id**: Task identifier (use with TaskGet, TaskUpdate)
- **subject**: Brief description of the task
- **status**: 'pending', 'in_progress', or 'completed'
- **owner**: Agent ID if assigned, empty if available
- **blockedBy**: List of open task IDs that must be resolved first (tasks with blockedBy cannot be claimed until dependencies resolve)

Use TaskGet with a specific task ID to view full details including description and comments.
</textarea>
