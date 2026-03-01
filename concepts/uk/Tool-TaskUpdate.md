# TaskUpdate

## Визначення

Оновлює статус, вміст або залежності завдання у списку завдань.

## Параметри

| Параметр | Тип | Обов'язковий | Опис |
|----------|-----|--------------|------|
| `taskId` | string | Так | ID завдання для оновлення |
| `status` | enum | Ні | Новий статус: `pending` / `in_progress` / `completed` / `deleted` |
| `subject` | string | Ні | Новий заголовок |
| `description` | string | Ні | Новий опис |
| `activeForm` | string | Ні | Текст у теперішньому тривалому часі, що відображається під час виконання |
| `owner` | string | Ні | Новий відповідальний за завдання (ім'я агента) |
| `metadata` | object | Ні | Метадані для об'єднання (встановлення null видаляє ключ) |
| `addBlocks` | string[] | Ні | Список ID завдань, заблокованих цим завданням |
| `addBlockedBy` | string[] | Ні | Список ID попередніх завдань, що блокують це завдання |

## Перехід статусів

```
pending → in_progress → completed
```

`deleted` можна перейти з будь-якого статусу, завдання видаляється назавжди.

## Сценарії використання

**Підходить для:**
- Позначення завдання як `in_progress` при початку роботи
- Позначення завдання як `completed` після завершення роботи
- Встановлення залежностей між завданнями
- Оновлення вмісту завдання при зміні вимог

**Важливі правила:**
- Позначайте як `completed` лише коли завдання повністю виконано
- При виникненні помилок або блокування залишайте `in_progress`
- Не позначайте як `completed` при невдалих тестах, неповній реалізації або невирішених помилках

## Примітки

- Перед оновленням отримайте актуальний стан завдання через TaskGet, щоб уникнути застарілих даних
- Після завершення завдання використовуйте TaskList для пошуку наступного доступного завдання

## Значення в cc-viewer

TaskUpdate — це внутрішня операція управління завданнями, яка не генерує окремого API-запиту.

## Оригінальний текст

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
