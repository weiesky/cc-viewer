# TaskList

## Визначення

Перелічує всі завдання у списку завдань, переглядає загальний прогрес та доступну роботу.

## Параметри

Без параметрів.

## Вміст відповіді

Зведена інформація по кожному завданню:
- `id` — Ідентифікатор завдання
- `subject` — Короткий опис
- `status` — Статус: `pending`, `in_progress` або `completed`
- `owner` — Відповідальний (agent ID), порожнє означає не призначено
- `blockedBy` — Список ID незавершених завдань, що блокують це завдання

## Сценарії використання

**Підходить для:**
- Перегляд доступних завдань (статус pending, без owner, не заблоковані)
- Перевірка загального прогресу проєкту
- Пошук заблокованих завдань
- Пошук наступного завдання після завершення поточного

## Примітки

- Надавайте перевагу обробці завдань у порядку ID (найменший ID першим), оскільки ранні завдання зазвичай надають контекст для наступних
- Завдання з `blockedBy` не можна брати до зняття залежності
- Використовуйте TaskGet для отримання повних деталей конкретного завдання

## Значення в cc-viewer

TaskList — це внутрішня операція управління завданнями, яка не генерує окремого API-запиту.

## Оригінальний текст

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
