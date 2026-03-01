# Agent

## Définition

Lance un sous-agent (SubAgent) pour gérer de manière autonome des tâches complexes multi-étapes. Les sous-agents sont des sous-processus indépendants, chacun avec son propre ensemble d'outils et contexte dédiés. Agent est la version renommée de l'outil Task dans les nouvelles versions de Claude Code.

## Paramètres

| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `prompt` | string | Oui | Description de la tâche à exécuter par le sous-agent |
| `description` | string | Oui | Résumé bref de 3-5 mots |
| `subagent_type` | string | Oui | Type de sous-agent, détermine l'ensemble d'outils disponibles |
| `model` | enum | Non | Spécifier le modèle (sonnet / opus / haiku), par défaut hérité du parent |
| `max_turns` | integer | Non | Nombre maximum de tours agentiques |
| `run_in_background` | boolean | Non | Si la tâche s'exécute en arrière-plan ; les tâches en arrière-plan renvoient le chemin du output_file |
| `resume` | string | Non | ID de l'agent à reprendre, continue depuis la dernière exécution. Utile pour reprendre un sous-agent précédent sans perdre le contexte |
| `isolation` | enum | Non | Mode d'isolation, `worktree` crée un git worktree temporaire |

## Types de sous-agents

| Type | Utilité | Outils disponibles |
|------|---------|-------------------|
| `Bash` | Exécution de commandes, opérations git | Bash |
| `general-purpose` | Tâches générales multi-étapes | Tous les outils |
| `Explore` | Exploration rapide de la base de code | Tous les outils sauf Agent/Edit/Write/NotebookEdit/ExitPlanMode |
| `Plan` | Concevoir des plans d'implémentation | Tous les outils sauf Agent/Edit/Write/NotebookEdit/ExitPlanMode |
| `claude-code-guide` | Questions-réponses sur le guide d'utilisation de Claude Code | Glob, Grep, Read, WebFetch, WebSearch |
| `statusline-setup` | Configurer la barre d'état | Read, Edit |

## Cas d'utilisation

**Adapté pour :**
- Tâches complexes nécessitant une réalisation autonome en plusieurs étapes
- Exploration de la base de code et recherche approfondie (utiliser le type Explore)
- Travail parallèle nécessitant des environnements isolés
- Tâches de longue durée nécessitant une exécution en arrière-plan

**Non adapté pour :**
- Lire des chemins de fichiers spécifiques — utiliser directement Read ou Glob
- Rechercher dans 2-3 fichiers connus — utiliser directement Read
- Rechercher des définitions de classes spécifiques — utiliser directement Glob

## Notes

- Le sous-agent renvoie un seul message à la fin, ses résultats ne sont pas visibles pour l'utilisateur et l'agent principal doit les transmettre
- Plusieurs appels Agent peuvent être lancés en parallèle dans un seul message pour améliorer l'efficacité
- Les tâches en arrière-plan vérifient la progression via l'outil TaskOutput
- Le type Explore est plus lent que l'appel direct à Glob/Grep, à utiliser uniquement quand la recherche simple ne suffit pas
- Utilisez `run_in_background: true` pour les tâches longues ne nécessitant pas de résultat immédiat ; utilisez le mode premier plan (par défaut) quand le résultat est nécessaire avant de continuer
- Le paramètre `resume` permet de continuer une session de sous-agent précédemment démarrée, en préservant le contexte accumulé

## Signification dans cc-viewer

Agent est le nouveau nom de l'outil Task dans les versions récentes de Claude Code. Les appels Agent produisent des chaînes de requêtes SubAgent, visibles dans la liste des requêtes comme des séquences de sous-requêtes indépendantes du MainAgent. Les requêtes SubAgent ont généralement un system prompt simplifié et moins de définitions d'outils, formant un contraste net avec le MainAgent. Dans cc-viewer, les noms d'outils `Task` ou `Agent` peuvent apparaître selon la version de Claude Code utilisée dans la conversation enregistrée.

## Texte original

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
