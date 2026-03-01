# Agent

## 정의

서브 agent (SubAgent)를 시작하여 복잡한 다단계 태스크를 자율적으로 처리합니다. 서브 agent는 독립된 서브프로세스로, 각각 전용 도구 세트와 컨텍스트를 가집니다. Agent는 최신 Claude Code 버전에서 Task 도구의 이름이 변경된 버전입니다.

## 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `prompt` | string | 예 | 서브 agent가 실행할 태스크 설명 |
| `description` | string | 예 | 3~5단어의 짧은 요약 |
| `subagent_type` | string | 예 | 서브 agent 타입, 사용 가능한 도구 세트를 결정 |
| `model` | enum | 아니오 | 모델 지정 (sonnet / opus / haiku), 기본값은 부모로부터 상속 |
| `max_turns` | integer | 아니오 | 최대 agentic 턴 수 |
| `run_in_background` | boolean | 아니오 | 백그라운드 실행 여부. 백그라운드 태스크는 output_file 경로를 반환 |
| `resume` | string | 아니오 | 재개할 agent ID, 이전 실행에서 계속. 컨텍스트를 잃지 않고 이전 서브 agent를 이어받는 데 유용 |
| `isolation` | enum | 아니오 | 격리 모드, `worktree`로 임시 git worktree 생성 |

## 서브 agent 타입

| 타입 | 용도 | 사용 가능한 도구 |
|------|------|------------------|
| `Bash` | 명령 실행, git 작업 | Bash |
| `general-purpose` | 범용 다단계 태스크 | 전체 도구 |
| `Explore` | 코드베이스 빠른 탐색 | Agent/Edit/Write/NotebookEdit/ExitPlanMode 외 모든 도구 |
| `Plan` | 구현 방안 설계 | Agent/Edit/Write/NotebookEdit/ExitPlanMode 외 모든 도구 |
| `claude-code-guide` | Claude Code 사용 가이드 Q&A | Glob, Grep, Read, WebFetch, WebSearch |
| `statusline-setup` | 상태 표시줄 설정 | Read, Edit |

## 사용 시나리오

**적합한 경우:**
- 다단계로 자율 완료해야 하는 복잡한 태스크
- 코드베이스 탐색 및 심층 조사 (Explore 타입 사용)
- 격리 환경이 필요한 병렬 작업
- 백그라운드 실행이 필요한 장시간 태스크

**적합하지 않은 경우:**
- 특정 파일 경로 읽기 — 직접 Read 또는 Glob 사용
- 2~3개 알려진 파일 내 검색 — 직접 Read 사용
- 특정 클래스 정의 검색 — 직접 Glob 사용

## 주의사항

- 서브 agent는 완료 후 단일 메시지를 반환하며, 그 결과는 사용자에게 보이지 않으므로 메인 agent가 전달해야 함
- 단일 메시지 내에서 여러 병렬 Agent 호출을 발행하여 효율 향상 가능
- 백그라운드 태스크는 TaskOutput 도구로 진행 상황 확인
- Explore 타입은 직접 Glob/Grep 호출보다 느리므로, 단순 검색으로 충분하지 않을 때만 사용
- 장시간 실행되며 즉시 결과가 필요 없는 태스크에는 `run_in_background: true` 권장; 결과가 필요한 경우 포그라운드(기본값) 사용
- `resume` 파라미터를 통해 이전에 시작한 서브 agent 세션을 계속할 수 있으며, 축적된 컨텍스트를 유지

## cc-viewer에서의 의의

Agent는 최신 Claude Code 버전에서 Task 도구의 새 이름입니다. Agent 호출은 SubAgent 요청 체인을 생성하며, 요청 목록에서 MainAgent와 독립된 서브 요청 시퀀스로 확인할 수 있습니다. SubAgent 요청은 보통 간결한 system prompt와 적은 도구 정의를 가지며, MainAgent와 뚜렷한 대비를 이룹니다. cc-viewer에서는 기록된 대화에서 사용된 Claude Code 버전에 따라 `Task` 또는 `Agent` 도구 이름이 표시될 수 있습니다.

## 원문

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
