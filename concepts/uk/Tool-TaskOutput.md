# TaskOutput

## Визначення

Отримує вивід фонового завдання, що виконується або завершилося. Підходить для фонових shell, асинхронних агентів та віддалених сесій.

## Параметри

| Параметр | Тип | Обов'язковий | Опис |
|----------|-----|--------------|------|
| `task_id` | string | Так | ID завдання |
| `block` | boolean | Так | Чи блокувати очікування завершення завдання, за замовчуванням `true` |
| `timeout` | number | Так | Максимальний час очікування (мілісекунди), за замовчуванням 30000, максимум 600000 |

## Сценарії використання

**Підходить для:**
- Перевірка прогресу фонового агента, запущеного через Task (`run_in_background: true`)
- Отримання результату виконання фонової команди Bash
- Очікування завершення асинхронного завдання та отримання виводу

**Не підходить для:**
- Завдання переднього плану — вони повертають результат безпосередньо, цей інструмент не потрібен

## Примітки

- `block: true` блокує до завершення завдання або тайм-ауту
- `block: false` використовується для неблокуючої перевірки поточного стану
- ID завдання можна знайти через команду `/tasks`
- Підходить для всіх типів завдань: фоновий shell, асинхронний агент, віддалена сесія

## Значення в cc-viewer

Виклик TaskOutput сам по собі не генерує API-запиту; це внутрішня операція управління завданнями Claude Code, яка не з'являється в журналі запитів.

## Оригінальний текст

<textarea readonly>- Retrieves output from a running or completed task (background shell, agent, or remote session)
- Takes a task_id parameter identifying the task
- Returns the task output along with status information
- Use block=true (default) to wait for task completion
- Use block=false for non-blocking check of current status
- Task IDs can be found using the /tasks command
- Works with all task types: background shells, async agents, and remote sessions</textarea>
