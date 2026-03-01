# Skill

## Определение

Выполняет навык (skill) в основном диалоге. Навыки — это специализированные возможности, которые пользователь может вызывать через slash command (например, `/commit`, `/review-pr`).

## Параметры

| Параметр | Тип | Обязательный | Описание |
|------|------|------|------|
| `skill` | string | Да | Название навыка (например, "commit", "review-pr", "pdf") |
| `args` | string | Нет | Аргументы навыка |

## Сценарии использования

**Подходящее применение:**
- Пользователь ввёл slash command в формате `/<skill-name>`
- Запрос пользователя соответствует функциональности зарегистрированного навыка

**Неподходящее применение:**
- Встроенные команды CLI (например, `/help`, `/clear`)
- Навык уже выполняется
- Название навыка отсутствует в списке доступных навыков

## Примечания

- После вызова навык разворачивается в полный prompt
- Поддерживает полностью квалифицированные имена (например, `ms-office-suite:pdf`)
- Список доступных навыков предоставляется в сообщениях system-reminder
- Когда виден тег `<command-name>`, это означает, что навык загружен — следует выполнить его напрямую, а не вызывать этот инструмент повторно
- Не упоминайте навык без фактического вызова инструмента

## Значение в cc-viewer

Вызов Skill в логах запросов отображается как блок content `tool_use`. Prompt, развёрнутый из навыка, влияет на system prompt или содержимое сообщений последующих запросов.

## Оригинальный текст

<textarea readonly>Execute a skill within the main conversation

When users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.

When users reference a "slash command" or "/<something>" (e.g., "/commit", "/review-pr"), they are referring to a skill. Use this tool to invoke it.

How to invoke:
- Use this tool with the skill name and optional arguments
- Examples:
  - `skill: "pdf"` - invoke the pdf skill
  - `skill: "commit", args: "-m 'Fix bug'"` - invoke with arguments
  - `skill: "review-pr", args: "123"` - invoke with arguments
  - `skill: "ms-office-suite:pdf"` - invoke using fully qualified name

Important:
- Available skills are listed in system-reminder messages in the conversation
- When a skill matches the user's request, this is a BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response about the task
- NEVER mention a skill without actually calling this tool
- Do not invoke a skill that is already running
- Do not use this tool for built-in CLI commands (like /help, /clear, etc.)
- If you see a <command-name> tag in the current conversation turn, the skill has ALREADY been loaded - follow the instructions directly instead of calling this tool again
</textarea>
