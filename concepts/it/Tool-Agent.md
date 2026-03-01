# Agent

## Definizione

Avvia un sub agent (SubAgent) per gestire autonomamente task complessi multi-step. I sub agent sono sottoprocessi indipendenti, ciascuno con il proprio set di strumenti e contesto dedicati. Agent è la versione rinominata dello strumento Task nelle versioni più recenti di Claude Code.

## Parametri

| Parametro | Tipo | Obbligatorio | Descrizione |
|------|------|------|------|
| `prompt` | string | Sì | Descrizione del task da eseguire per il sub agent |
| `description` | string | Sì | Breve riepilogo di 3-5 parole |
| `subagent_type` | string | Sì | Tipo di sub agent, determina il set di strumenti disponibili |
| `model` | enum | No | Specifica il modello (sonnet / opus / haiku), predefinito ereditato dal padre |
| `max_turns` | integer | No | Numero massimo di turni agentici |
| `run_in_background` | boolean | No | Se eseguire in background; i task in background restituiscono il percorso output_file |
| `resume` | string | No | ID dell'agent da riprendere, continua dall'ultima esecuzione. Utile per riprendere un sub agent precedente senza perdere il contesto |
| `isolation` | enum | No | Modalità di isolamento, `worktree` crea un git worktree temporaneo |

## Tipi di sub agent

| Tipo | Scopo | Strumenti disponibili |
|------|------|----------|
| `Bash` | Esecuzione comandi, operazioni git | Bash |
| `general-purpose` | Task multi-step generici | Tutti gli strumenti |
| `Explore` | Esplorazione rapida del codebase | Tutti gli strumenti tranne Agent/Edit/Write/NotebookEdit/ExitPlanMode |
| `Plan` | Progettazione del piano di implementazione | Tutti gli strumenti tranne Agent/Edit/Write/NotebookEdit/ExitPlanMode |
| `claude-code-guide` | Q&A sulla guida all'uso di Claude Code | Glob, Grep, Read, WebFetch, WebSearch |
| `statusline-setup` | Configurazione della barra di stato | Read, Edit |

## Scenari d'uso

**Adatto per:**
- Task complessi che richiedono il completamento autonomo in più step
- Esplorazione del codebase e ricerca approfondita (usando il tipo Explore)
- Lavoro parallelo che richiede ambienti isolati
- Task a lunga esecuzione che devono essere eseguiti in background

**Non adatto per:**
- Leggere un percorso file specifico — usare direttamente Read o Glob
- Cercare in 2-3 file noti — usare direttamente Read
- Cercare una definizione di classe specifica — usare direttamente Glob

## Note

- Al completamento, il sub agent restituisce un singolo messaggio; il suo risultato non è visibile all'utente e deve essere riportato dall'agent principale
- È possibile lanciare più chiamate Agent in parallelo in un singolo messaggio per migliorare l'efficienza
- I task in background vengono monitorati tramite lo strumento TaskOutput
- Il tipo Explore è più lento delle chiamate dirette a Glob/Grep, usarlo solo quando la ricerca semplice non è sufficiente
- Usare `run_in_background: true` per task a lunga esecuzione che non necessitano di risultati immediati; usare la modalità in primo piano (predefinita) quando il risultato è necessario prima di procedere
- Il parametro `resume` consente di continuare una sessione di sub agent avviata in precedenza, preservando il contesto accumulato

## Significato in cc-viewer

Agent è il nuovo nome dello strumento Task nelle versioni recenti di Claude Code. Le chiamate Agent generano catene di richieste SubAgent, visibili nella lista delle richieste come sequenze di sotto-richieste indipendenti dal MainAgent. Le richieste SubAgent hanno tipicamente un system prompt semplificato e meno definizioni di strumenti, in netto contrasto con il MainAgent. In cc-viewer, possono apparire i nomi strumento `Task` o `Agent` a seconda della versione di Claude Code utilizzata nella conversazione registrata.

## Testo originale

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
