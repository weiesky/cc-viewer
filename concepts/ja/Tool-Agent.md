# Agent

## 定義

サブ agent（SubAgent）を起動して、複雑なマルチステップタスクを自律的に処理します。サブ agent は独立したサブプロセスで、それぞれ専用のツールセットとコンテキストを持ちます。Agent は新しい Claude Code バージョンにおける Task ツールのリネーム版です。

## パラメータ

| パラメータ | 型 | 必須 | 説明 |
|------------|------|------|------|
| `prompt` | string | はい | サブ agent が実行するタスクの説明 |
| `description` | string | はい | 3〜5語の短い要約 |
| `subagent_type` | string | はい | サブ agent タイプ、利用可能なツールセットを決定 |
| `model` | enum | いいえ | モデルを指定（sonnet / opus / haiku）、デフォルトは親から継承 |
| `max_turns` | integer | いいえ | 最大 agentic ターン数 |
| `run_in_background` | boolean | いいえ | バックグラウンドで実行するかどうか。バックグラウンドタスクは output_file パスを返す |
| `resume` | string | いいえ | 再開する agent ID、前回の実行から続行。コンテキストを失わずに以前のサブ agent を引き継ぐのに有用 |
| `isolation` | enum | いいえ | 隔離モード、`worktree` で一時的な git worktree を作成 |

## サブ agent タイプ

| タイプ | 用途 | 利用可能なツール |
|--------|------|------------------|
| `Bash` | コマンド実行、git 操作 | Bash |
| `general-purpose` | 汎用マルチステップタスク | 全ツール |
| `Explore` | コードベースの高速探索 | Agent/Edit/Write/NotebookEdit/ExitPlanMode 以外のすべて |
| `Plan` | 実装方針の設計 | Agent/Edit/Write/NotebookEdit/ExitPlanMode 以外のすべて |
| `claude-code-guide` | Claude Code 使用ガイド Q&A | Glob, Grep, Read, WebFetch, WebSearch |
| `statusline-setup` | ステータスバーの設定 | Read, Edit |

## 使用シナリオ

**適している場合：**
- マルチステップで自律的に完了する必要がある複雑なタスク
- コードベースの探索と深い調査（Explore タイプを使用）
- 隔離環境が必要な並列作業
- バックグラウンドで実行する必要がある長時間タスク

**適していない場合：**
- 特定のファイルパスの読み取り——直接 Read または Glob を使用
- 2〜3個の既知ファイル内の検索——直接 Read を使用
- 特定のクラス定義の検索——直接 Glob を使用

## 注意事項

- サブ agent は完了後に単一メッセージを返し、その結果はユーザーには見えないため、メイン agent が伝達する必要がある
- 単一メッセージ内で複数の並列 Agent 呼び出しを発行して効率を向上できる
- バックグラウンドタスクは TaskOutput ツールで進捗を確認
- Explore タイプは直接 Glob/Grep を呼び出すより遅いため、単純な検索では不十分な場合にのみ使用
- 長時間実行で即座に結果が不要なタスクには `run_in_background: true` を推奨。結果が必要な場合はフォアグラウンド（デフォルト）を使用
- `resume` パラメータにより、以前開始したサブ agent セッションを継続でき、蓄積されたコンテキストを保持

## cc-viewer での意義

Agent は新しい Claude Code バージョンにおける Task ツールの新名称です。Agent 呼び出しは SubAgent リクエストチェーンを生成し、リクエストリストで MainAgent とは独立したサブリクエストシーケンスとして確認できます。SubAgent リクエストは通常、簡潔な system prompt と少ないツール定義を持ち、MainAgent と明確な対比を形成します。cc-viewer では、記録された会話で使用された Claude Code のバージョンに応じて、`Task` または `Agent` のいずれかのツール名が表示される場合があります。

## 原文

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
