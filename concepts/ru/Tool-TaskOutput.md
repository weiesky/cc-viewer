# TaskOutput

## Определение

Получает вывод работающей или завершённой фоновой задачи. Применимо к фоновым оболочкам, асинхронным агентам и удалённым сессиям.

## Параметры

| Параметр | Тип | Обязательный | Описание |
|------|------|------|------|
| `task_id` | string | Да | ID задачи |
| `block` | boolean | Да | Блокировать ли до завершения задачи, по умолчанию `true` |
| `timeout` | number | Да | Максимальное время ожидания (миллисекунды), по умолчанию 30000, макс. 600000 |

## Сценарии использования

**Подходящее применение:**
- Проверка прогресса фонового агента, запущенного через Task (`run_in_background: true`)
- Получение результатов команд Bash, запущенных в фоне
- Ожидание завершения асинхронной задачи и получение вывода

**Неподходящее применение:**
- Задачи переднего плана — задачи переднего плана возвращают результат напрямую, этот инструмент не нужен

## Примечания

- `block: true` блокирует до завершения задачи или истечения тайм-аута
- `block: false` используется для неблокирующей проверки текущего состояния
- ID задачи можно найти через команду `/tasks`
- Применимо ко всем типам задач: фоновые оболочки, асинхронные агенты, удалённые сессии

## Значение в cc-viewer

Вызов TaskOutput сам по себе не порождает API-запрос — это внутренняя операция управления задачами Claude Code, не отображающаяся в логах запросов.

## Оригинальный текст

<textarea readonly>- Retrieves output from a running or completed task (background shell, agent, or remote session)
- Takes a task_id parameter identifying the task
- Returns the task output along with status information
- Use block=true (default) to wait for task completion
- Use block=false for non-blocking check of current status
- Task IDs can be found using the /tasks command
- Works with all task types: background shells, async agents, and remote sessions</textarea>
