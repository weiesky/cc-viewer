# TaskCreate

## Определение

Создаёт структурированную запись в списке задач для отслеживания прогресса, организации сложных задач и демонстрации пользователю хода работы.

## Параметры

| Параметр | Тип | Обязательный | Описание |
|------|------|------|------|
| `subject` | string | Да | Краткий заголовок задачи в повелительном наклонении (например, "Fix authentication bug") |
| `description` | string | Да | Подробное описание, включающее контекст и критерии приёмки |
| `activeForm` | string | Нет | Текст в настоящем продолженном времени, отображаемый во время выполнения (например, "Fixing authentication bug") |
| `metadata` | object | Нет | Произвольные метаданные, прикреплённые к задаче |

## Сценарии использования

**Подходящее применение:**
- Сложные многоэтапные задачи (более 3 шагов)
- Пользователь предоставил несколько элементов для выполнения
- Отслеживание работы в режиме планирования
- Пользователь явно попросил использовать список todo

**Неподходящее применение:**
- Одиночная простая задача
- Простые операции менее чем в 3 шага
- Чистый диалог или информационный запрос

## Примечания

- Все вновь созданные задачи имеют начальный статус `pending`
- `subject` использует повелительное наклонение ("Run tests"), `activeForm` — настоящее продолженное время ("Running tests")
- После создания задачи можно установить зависимости (blocks/blockedBy) через TaskUpdate
- Перед созданием следует вызвать TaskList для проверки на дубликаты

## Значение в cc-viewer

TaskCreate — это внутренняя операция управления задачами Claude Code, не порождающая независимого API-запроса. Однако в Chat Mode можно увидеть блок tool_use, в котором модель вызывает этот инструмент.

## Оригинальный текст

<textarea readonly>Use this tool to create a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

## When to Use This Tool

Use this tool proactively in these scenarios:

- Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
- Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
- Plan mode - When using plan mode, create a task list to track the work
- User explicitly requests todo list - When the user directly asks you to use the todo list
- User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
- After receiving new instructions - Immediately capture user requirements as tasks
- When you start working on a task - Mark it as in_progress BEFORE beginning work
- After completing a task - Mark it as completed and add any new follow-up tasks discovered during implementation

## When NOT to Use This Tool

Skip using this tool when:
- There is only a single, straightforward task
- The task is trivial and tracking it provides no organizational benefit
- The task can be completed in less than 3 trivial steps
- The task is purely conversational or informational

NOTE that you should not use this tool if there is only one trivial task to do. In this case you are better off just doing the task directly.

## Task Fields

- **subject**: A brief, actionable title in imperative form (e.g., "Fix authentication bug in login flow")
- **description**: Detailed description of what needs to be done, including context and acceptance criteria
- **activeForm**: Present continuous form shown in spinner when task is in_progress (e.g., "Fixing authentication bug"). This is displayed to the user while you work on the task.

**IMPORTANT**: Always provide activeForm when creating tasks. The subject should be imperative ("Run tests") while activeForm should be present continuous ("Running tests"). All tasks are created with status `pending`.

## Tips

- Create tasks with clear, specific subjects that describe the outcome
- Include enough detail in the description for another agent to understand and complete the task
- After creating tasks, use TaskUpdate to set up dependencies (blocks/blockedBy) if needed
- Check TaskList first to avoid creating duplicate tasks
</textarea>
