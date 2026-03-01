# ExitPlanMode

## Определение

Выходит из режима планирования и отправляет план на утверждение пользователю. Содержимое плана считывается из ранее записанного файла плана.

## Параметры

| Параметр | Тип | Обязательный | Описание |
|------|------|------|------|
| `allowedPrompts` | array | Нет | Список описаний разрешений, необходимых для реализации плана |

Каждый элемент массива `allowedPrompts`:

| Поле | Тип | Обязательный | Описание |
|------|------|------|------|
| `tool` | enum | Да | Применимый инструмент, в настоящее время поддерживается только `Bash` |
| `prompt` | string | Да | Семантическое описание операции (например, "run tests", "install dependencies") |

## Сценарии использования

**Подходящее применение:**
- План в режиме планирования завершён, готов к отправке на утверждение пользователю
- Только для задач реализации, требующих написания кода

**Неподходящее применение:**
- Чисто исследовательские задачи — не требуют выхода из режима планирования
- Хотите спросить пользователя «план подходит?» — это именно функция данного инструмента, не используйте AskUserQuestion для этого

## Примечания

- Этот инструмент не принимает содержимое плана в качестве параметра — он считывает его из ранее записанного файла плана
- Пользователь увидит содержимое файла плана для утверждения
- Не спрашивайте через AskUserQuestion «подходит ли план» перед вызовом этого инструмента — это дублирование
- Не упоминайте «план» в вопросах, так как пользователь не видит содержимое плана до ExitPlanMode

## Значение в cc-viewer

Вызов ExitPlanMode обозначает конец фазы планирования. В логах запросов запросы после этого вызова обычно переходят к операциям реализации (Edit, Write, Bash и т.д.).

## Оригинальный текст

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
