# Agent

## Визначення

Запускає підагента (SubAgent) для автономної обробки складних багатокрокових завдань. Підагенти — це незалежні підпроцеси, кожен з яких має власний набір інструментів та контекст. Agent — це перейменована версія інструменту Task у нових версіях Claude Code.

## Параметри

| Параметр | Тип | Обов'язковий | Опис |
|----------|-----|--------------|------|
| `prompt` | string | Так | Опис завдання для виконання підагентом |
| `description` | string | Так | Короткий опис у 3-5 слів |
| `subagent_type` | string | Так | Тип підагента, визначає доступний набір інструментів |
| `model` | enum | Ні | Вказати модель (sonnet / opus / haiku), за замовчуванням успадковується від батьківського |
| `max_turns` | integer | Ні | Максимальна кількість агентних раундів |
| `run_in_background` | boolean | Ні | Чи запускати у фоновому режимі; фонові завдання повертають шлях output_file |
| `resume` | string | Ні | ID агента для відновлення, продовжує з останнього виконання. Корисно для продовження попереднього підагента без втрати контексту |
| `isolation` | enum | Ні | Режим ізоляції, `worktree` створює тимчасовий git worktree |

## Типи підагентів

| Тип | Призначення | Доступні інструменти |
|-----|-------------|---------------------|
| `Bash` | Виконання команд, операції git | Bash |
| `general-purpose` | Загальні багатокрокові завдання | Усі інструменти |
| `Explore` | Швидке дослідження кодової бази | Усі інструменти, крім Agent/Edit/Write/NotebookEdit/ExitPlanMode |
| `Plan` | Проєктування плану реалізації | Усі інструменти, крім Agent/Edit/Write/NotebookEdit/ExitPlanMode |
| `claude-code-guide` | Запитання-відповіді з посібника Claude Code | Glob, Grep, Read, WebFetch, WebSearch |
| `statusline-setup` | Налаштування рядка стану | Read, Edit |

## Сценарії використання

**Підходить для:**
- Складні завдання, що потребують багатокрокового автономного виконання
- Дослідження кодової бази та глибокий аналіз (з типом Explore)
- Паралельна робота, що потребує ізольованого середовища
- Довготривалі завдання, що потребують фонового виконання

**Не підходить для:**
- Читання конкретного шляху файлу — використовуйте безпосередньо Read або Glob
- Пошук у 2-3 відомих файлах — використовуйте безпосередньо Read
- Пошук конкретного визначення класу — використовуйте безпосередньо Glob

## Примітки

- Після завершення підагент повертає одне повідомлення; його результати не видимі користувачу, основний агент повинен їх передати
- Для підвищення ефективності можна запускати кілька паралельних викликів Agent в одному повідомленні
- Прогрес фонових завдань перевіряється через інструмент TaskOutput
- Тип Explore повільніший за прямий виклик Glob/Grep, використовуйте лише коли простого пошуку недостатньо
- Використовуйте `run_in_background: true` для довготривалих завдань, що не потребують негайного результату; використовуйте режим переднього плану (за замовчуванням), коли результат потрібен перед продовженням
- Параметр `resume` дозволяє продовжити раніше розпочату сесію підагента, зберігаючи накопичений контекст

## Значення в cc-viewer

Agent — це нова назва інструменту Task в останніх версіях Claude Code. Виклики Agent створюють ланцюг запитів SubAgent; у списку запитів можна побачити послідовності підзапитів, незалежні від MainAgent. Запити SubAgent зазвичай мають скорочений system prompt та менше визначень інструментів, що створює помітний контраст з MainAgent. У cc-viewer можуть відображатися назви інструментів `Task` або `Agent` залежно від версії Claude Code, використаної в записаній розмові.

## Оригінальний текст

<textarea readonly>Launch a new agent to handle complex, multi-step tasks autonomously.

The Agent tool launches specialized agents (subprocesses) that autonomously handle complex tasks. Each agent type has specific capabilities and tools available to it.

Available agent types and the tools they have access to:
- general-purpose: General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you. (Tools: *)
- statusline-setup: Use this agent to configure the user's Claude Code status line setting. (Tools: Read, Edit)
- Explore: Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions. (Tools: All tools except Agent, ExitPlanMode, Edit, Write, NotebookEdit)
- Plan: Software architect agent for designing implementation plans. Use this when you need to plan the implementation strategy for a task. Returns step-by-step plans, identifies critical files, and considers architectural trade-offs. (Tools: All tools except Agent, ExitPlanMode, Edit, Write, NotebookEdit)
- claude-code-guide: Use this agent when the user asks questions ("Can Claude...", "Does Claude...", "How do I...") about: (1) Claude Code (the CLI tool) - features, hooks, slash commands, MCP servers, settings, IDE integrations, keyboard shortcuts; (2) Claude Agent SDK - building custom agents; (3) Claude API (formerly Anthropic API) - API usage, tool use, Anthropic SDK usage. **IMPORTANT:** Before spawning a new agent, check if there is already a running or recently completed claude-code-guide agent that you can resume using the "resume" parameter. (Tools: Glob, Grep, Read, WebFetch, WebSearch)

When using the Agent tool, you must specify a subagent_type parameter to select which agent type to use.

When NOT to use the Agent tool:
- If you want to read a specific file path, use the Read or Glob tool instead of the Agent tool, to find the match more quickly
- If you are searching for a specific class definition like "class Foo", use the Glob tool instead, to find the match more quickly
- If you are searching for code within a specific file or set of 2-3 files, use the Read tool instead of the Agent tool, to find the match more quickly
- Other tasks that are not related to the agent descriptions above


Usage notes:
- Always include a short description (3-5 words) summarizing what the agent will do
- Launch multiple agents concurrently whenever possible, to maximize performance; to do that, use a single message with multiple tool uses
- When the agent is done, it will return a single message back to you. The result returned by the agent is not visible to the user. To show the user the result, you should send a text message back to the user with a concise summary of the result.
- You can optionally run agents in the background using the run_in_background parameter. When an agent runs in the background, you will be automatically notified when it completes — do NOT sleep, poll, or proactively check on its progress. Continue with other work or respond to the user instead.
- **Foreground vs background**: Use foreground (default) when you need the agent's results before you can proceed — e.g., research agents whose findings inform your next steps. Use background when you have genuinely independent work to do in parallel.
- Agents can be resumed using the `resume` parameter by passing the agent ID from a previous invocation. When resumed, the agent continues with its full previous context preserved. When NOT resuming, each invocation starts fresh and you should provide a detailed task description with all necessary context.
- When the agent is done, it will return a single message back to you along with its agent ID. You can use this ID to resume the agent later if needed for follow-up work.
- Provide clear, detailed prompts so the agent can work autonomously and return exactly the information you need.
- Agents with "access to current context" can see the full conversation history before the tool call. When using these agents, you can write concise prompts that reference earlier context (e.g., "investigate the error discussed above") instead of repeating information. The agent will receive all prior messages and understand the context.
- The agent's outputs should generally be trusted
- Clearly tell the agent whether you expect it to write code or just to do research (search, file reads, web fetches, etc.), since it is not aware of the user's intent
- If the agent description mentions that it should be used proactively, then you should try your best to use it without the user having to ask for it first. Use your judgement.
- If the user specifies that they want you to run agents "in parallel", you MUST send a single message with multiple Agent tool use content blocks. For example, if you need to launch both a build-validator agent and a test-runner agent in parallel, send a single message with both tool calls.
- You can optionally set `isolation: "worktree"` to run the agent in a temporary git worktree, giving it an isolated copy of the repository. The worktree is automatically cleaned up if the agent makes no changes; if changes are made, the worktree path and branch are returned in the result.

Example usage:

<example_agent_descriptions>
"test-runner": use this agent after you are done writing code to run tests
"greeting-responder": use this agent to respond to user greetings with a friendly joke
</example_agent_descriptions>

<example>
user: "Please write a function that checks if a number is prime"
assistant: Sure let me write a function that checks if a number is prime
assistant: First let me use the Write tool to write a function that checks if a number is prime
assistant: I'm going to use the Write tool to write the following code:
<code>
function isPrime(n) {
  if (n <= 1) return false
  for (let i = 2; i * i <= n; i++) {
    if (n % i === 0) return false
  }
  return true
}
</code>
<commentary>
Since a significant piece of code was written and the task was completed, now use the test-runner agent to run the tests
</commentary>
assistant: Now let me use the test-runner agent to run the tests
assistant: Uses the Agent tool to launch the test-runner agent
</example>

<example>
user: "Hello"
<commentary>
Since the user is greeting, use the greeting-responder agent to respond with a friendly joke
</commentary>
assistant: "I'm going to use the Agent tool to launch the greeting-responder agent"
</example>
</textarea>
