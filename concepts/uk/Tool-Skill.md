# Skill

## Визначення

Виконує навичку (skill) в основній розмові. Навички — це спеціалізовані можливості, які користувач може викликати через slash command (наприклад, `/commit`, `/review-pr`).

## Параметри

| Параметр | Тип | Обов'язковий | Опис |
|----------|-----|--------------|------|
| `skill` | string | Так | Назва навички (наприклад, "commit", "review-pr", "pdf") |
| `args` | string | Ні | Параметри навички |

## Сценарії використання

**Підходить для:**
- Користувач ввів slash command у форматі `/<skill-name>`
- Запит користувача відповідає функціональності зареєстрованої навички

**Не підходить для:**
- Вбудовані CLI-команди (наприклад, `/help`, `/clear`)
- Навичка, що вже виконується
- Назви навичок, яких немає у списку доступних

## Примітки

- Після виклику навичка розгортається у повний prompt
- Підтримуються повні кваліфіковані назви (наприклад, `ms-office-suite:pdf`)
- Список доступних навичок надається в повідомленнях system-reminder
- Коли видно тег `<command-name>`, навичка вже завантажена — слід виконувати безпосередньо, а не викликати цей інструмент знову
- Не згадуйте навичку, не викликавши інструмент фактично

## Значення в cc-viewer

Виклики Skill відображаються в журналі запитів як `tool_use` content block. Prompt, розгорнутий після навички, впливає на system prompt або вміст повідомлень наступних запитів.

## Оригінальний текст

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
