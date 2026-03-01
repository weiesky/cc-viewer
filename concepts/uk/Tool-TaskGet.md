# TaskGet

## Визначення

Отримує повні деталі завдання за його ID.

## Параметри

| Параметр | Тип | Обов'язковий | Опис |
|----------|-----|--------------|------|
| `taskId` | string | Так | ID завдання для отримання |

## Вміст відповіді

- `subject` — Заголовок завдання
- `description` — Детальні вимоги та контекст
- `status` — Статус: `pending`, `in_progress` або `completed`
- `blocks` — Список завдань, заблокованих цим завданням
- `blockedBy` — Список попередніх завдань, що блокують це завдання

## Сценарії використання

**Підходить для:**
- Отримання повного опису та контексту завдання перед початком роботи
- Розуміння залежностей завдання
- Отримання повних вимог після призначення завдання

## Примітки

- Після отримання завдання слід перевірити, чи порожній список `blockedBy`, перш ніж починати роботу
- Використовуйте TaskList для перегляду зведеної інформації про всі завдання

## Значення в cc-viewer

TaskGet — це внутрішня операція управління завданнями, яка не генерує окремого API-запиту.

## Оригінальний текст

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
