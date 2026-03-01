# ExitPlanMode

## 정의

계획 모드를 종료하고 방안을 사용자 승인에 제출합니다. 방안 내용은 이전에 작성된 계획 파일에서 읽어옵니다.

## 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `allowedPrompts` | array | 아니오 | 구현 방안에 필요한 권한 설명 목록 |

`allowedPrompts` 배열의 각 요소:

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `tool` | enum | 예 | 적용할 도구, 현재 `Bash`만 지원 |
| `prompt` | string | 예 | 작업의 의미적 설명 (예: "run tests", "install dependencies") |

## 사용 시나리오

**적합한 경우:**
- 계획 모드에서 방안이 완성되어 사용자 승인에 제출할 준비가 됨
- 코드를 작성해야 하는 구현 태스크에만 사용

**적합하지 않은 경우:**
- 순수 조사/탐색 태스크 — 계획 모드를 종료할 필요 없음
- 사용자에게 "방안이 괜찮으신가요?"라고 묻고 싶은 경우 — 이것이 바로 이 도구의 기능이므로 AskUserQuestion으로 묻지 말 것

## 주의사항

- 이 도구는 방안 내용을 파라미터로 받지 않음 — 이전에 작성된 계획 파일에서 읽어옴
- 사용자는 계획 파일의 내용을 보고 승인함
- 이 도구를 호출하기 전에 AskUserQuestion으로 "방안이 괜찮은지" 묻지 말 것. 중복됨
- 질문에서 "계획"을 언급하지 말 것. 사용자는 ExitPlanMode 전에 계획 내용을 볼 수 없기 때문

## cc-viewer에서의 의의

ExitPlanMode 호출은 계획 단계의 종료를 나타냅니다. 요청 로그에서 이 호출 이후의 요청은 보통 구현적 작업 (Edit, Write, Bash 등)으로 전환됩니다.

## 원문

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
