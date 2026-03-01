# TaskCreate

## Визначення

Створює запис структурованого списку завдань для відстеження прогресу, організації складних завдань та демонстрації ходу роботи користувачу.

## Параметри

| Параметр | Тип | Обов'язковий | Опис |
|----------|-----|--------------|------|
| `subject` | string | Так | Короткий заголовок завдання, використовується наказовий спосіб (наприклад, "Fix authentication bug") |
| `description` | string | Так | Детальний опис, включаючи контекст та критерії прийняття |
| `activeForm` | string | Ні | Текст у теперішньому тривалому часі, що відображається під час виконання (наприклад, "Fixing authentication bug") |
| `metadata` | object | Ні | Довільні метадані, прикріплені до завдання |

## Сценарії використання

**Підходить для:**
- Складні багатокрокові завдання (більше 3 кроків)
- Користувач надав кілька справ для виконання
- Відстеження роботи в режимі планування
- Користувач явно просить використовувати список todo

**Не підходить для:**
- Одне просте завдання
- Прості операції менш ніж за 3 кроки
- Суто розмова або інформаційний запит

## Примітки

- Усі нові завдання мають початковий статус `pending`
- `subject` використовує наказовий спосіб ("Run tests"), `activeForm` — теперішній тривалий час ("Running tests")
- Після створення можна встановити залежності (blocks/blockedBy) через TaskUpdate
- Перед створенням слід перевірити наявність дублікатів через TaskList

## Значення в cc-viewer

TaskCreate — це внутрішня операція управління завданнями Claude Code, яка не генерує окремого API-запиту. Проте в Chat Mode можна побачити tool_use block виклику цього інструменту моделлю.

## Оригінальний текст

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
