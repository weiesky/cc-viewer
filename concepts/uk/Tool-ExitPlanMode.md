# ExitPlanMode

## Визначення

Виходить з режиму планування та подає план на затвердження користувачем. Вміст плану зчитується з раніше записаного файлу плану.

## Параметри

| Параметр | Тип | Обов'язковий | Опис |
|----------|-----|--------------|------|
| `allowedPrompts` | array | Ні | Список описів дозволів, необхідних для плану реалізації |

Кожен елемент масиву `allowedPrompts`:

| Поле | Тип | Обов'язковий | Опис |
|------|-----|--------------|------|
| `tool` | enum | Так | Застосовний інструмент, наразі підтримується лише `Bash` |
| `prompt` | string | Так | Семантичний опис операції (наприклад, "run tests", "install dependencies") |

## Сценарії використання

**Підходить для:**
- У режимі планування план завершено, готовий до подання на затвердження користувачем
- Лише для завдань реалізації, що потребують написання коду

**Не підходить для:**
- Суто дослідницьке/розвідувальне завдання — не потрібно виходити з режиму планування
- Запитання користувачу "Чи підходить план?" — це саме функція цього інструменту, не використовуйте AskUserQuestion

## Примітки

- Цей інструмент не приймає вміст плану як параметр — він зчитує з раніше записаного файлу плану
- Користувач побачить вміст файлу плану для затвердження
- Не запитуйте "чи підходить план?" через AskUserQuestion перед викликом цього інструменту — це дублювання
- Не згадуйте "план" у запитаннях, оскільки користувач не бачить вміст плану до ExitPlanMode

## Значення в cc-viewer

Виклик ExitPlanMode позначає завершення етапу планування. У журналі запитів після цього виклику запити зазвичай переходять до операцій реалізації (Edit, Write, Bash тощо).

## Оригінальний текст

<textarea readonly>Use this tool when you are in plan mode and have finished writing your plan to the plan file and are ready for user approval.

## How This Tool Works
- You should have already written your plan to the plan file specified in the plan mode system message
- This tool does NOT take the plan content as a parameter - it will read the plan from the file you wrote
- This tool simply signals that you're done planning and ready for the user to review and approve
- The user will see the contents of your plan file when they review it

## When to Use This Tool
IMPORTANT: Only use this tool when the task requires planning the implementation steps of a task that requires writing code. For research tasks where you're gathering information, searching files, reading files or in general trying to understand the codebase - do NOT use this tool.

## Before Using This Tool
Ensure your plan is complete and unambiguous:
- If you have unresolved questions about requirements or approach, use AskUserQuestion first (in earlier phases)
- Once your plan is finalized, use THIS tool to request approval

**Important:** Do NOT use AskUserQuestion to ask "Is this plan okay?" or "Should I proceed?" - that's exactly what THIS tool does. ExitPlanMode inherently requests user approval of your plan.

## Examples

1. Initial task: "Search for and understand the implementation of vim mode in the codebase" - Do not use the exit plan mode tool because you are not planning the implementation steps of a task.
2. Initial task: "Help me implement yank mode for vim" - Use the exit plan mode tool after you have finished planning the implementation steps of the task.
3. Initial task: "Add a new feature to handle user authentication" - If unsure about auth method (OAuth, JWT, etc.), use AskUserQuestion first, then use exit plan mode tool after clarifying the approach.
</textarea>
