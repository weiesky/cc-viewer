# TaskUpdate

## Определение

Обновляет статус, содержимое или зависимости задачи в списке задач.

## Параметры

| Параметр | Тип | Обязательный | Описание |
|------|------|------|------|
| `taskId` | string | Да | ID задачи для обновления |
| `status` | enum | Нет | Новый статус: `pending` / `in_progress` / `completed` / `deleted` |
| `subject` | string | Нет | Новый заголовок |
| `description` | string | Нет | Новое описание |
| `activeForm` | string | Нет | Текст в настоящем продолженном времени, отображаемый во время выполнения |
| `owner` | string | Нет | Новый ответственный за задачу (имя агента) |
| `metadata` | object | Нет | Метаданные для слияния (установка в null удаляет ключ) |
| `addBlocks` | string[] | Нет | Список ID задач, заблокированных этой задачей |
| `addBlockedBy` | string[] | Нет | Список ID предшествующих задач, блокирующих эту задачу |

## Переход статусов

```
pending → in_progress → completed
```

`deleted` может быть установлен из любого статуса, безвозвратно удаляет задачу.

## Сценарии использования

**Подходящее применение:**
- Пометка задачи как `in_progress` при начале работы
- Пометка задачи как `completed` после завершения работы
- Установка зависимостей между задачами
- Обновление содержимого задачи при изменении требований

**Важные правила:**
- Помечайте как `completed` только при полном завершении задачи
- При ошибках или блокировках сохраняйте статус `in_progress`
- Не помечайте как `completed`, когда тесты не проходят, реализация неполная или возникли неразрешённые ошибки

## Примечания

- Перед обновлением следует получить актуальное состояние задачи через TaskGet, чтобы избежать устаревших данных
- После завершения задачи вызовите TaskList для поиска следующей доступной задачи

## Значение в cc-viewer

TaskUpdate — это внутренняя операция управления задачами, не порождающая независимого API-запроса.

## Оригинальный текст

<textarea readonly>Use this tool to update a task in the task list.

## When to Use This Tool

**Mark tasks as resolved:**
- When you have completed the work described in a task
- When a task is no longer needed or has been superseded
- IMPORTANT: Always mark your assigned tasks as resolved when you finish them
- After resolving, call TaskList to find your next task

- ONLY mark a task as completed when you have FULLY accomplished it
- If you encounter errors, blockers, or cannot finish, keep the task as in_progress
- When blocked, create a new task describing what needs to be resolved
- Never mark a task as completed if:
  - Tests are failing
  - Implementation is partial
  - You encountered unresolved errors
  - You couldn't find necessary files or dependencies

**Delete tasks:**
- When a task is no longer relevant or was created in error
- Setting status to `deleted` permanently removes the task

**Update task details:**
- When requirements change or become clearer
- When establishing dependencies between tasks

## Fields You Can Update

- **status**: The task status (see Status Workflow below)
- **subject**: Change the task title (imperative form, e.g., "Run tests")
- **description**: Change the task description
- **activeForm**: Present continuous form shown in spinner when in_progress (e.g., "Running tests")
- **owner**: Change the task owner (agent name)
- **metadata**: Merge metadata keys into the task (set a key to null to delete it)
- **addBlocks**: Mark tasks that cannot start until this one completes
- **addBlockedBy**: Mark tasks that must complete before this one can start

## Status Workflow

Status progresses: `pending` → `in_progress` → `completed`

Use `deleted` to permanently remove a task.

## Staleness

Make sure to read a task's latest state using `TaskGet` before updating it.

## Examples

Mark task as in progress when starting work:
```json
{"taskId": "1", "status": "in_progress"}
```

Mark task as completed after finishing work:
```json
{"taskId": "1", "status": "completed"}
```

Delete a task:
```json
{"taskId": "1", "status": "deleted"}
```

Claim a task by setting owner:
```json
{"taskId": "1", "owner": "my-name"}
```

Set up task dependencies:
```json
{"taskId": "2", "addBlockedBy": ["1"]}
```
</textarea>
