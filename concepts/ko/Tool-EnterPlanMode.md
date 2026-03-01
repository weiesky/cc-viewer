# EnterPlanMode

## 정의

Claude Code를 계획 모드로 전환하여, 구현 전에 코드베이스를 탐색하고 방안을 설계하는 데 사용합니다.

## 파라미터

파라미터 없음.

## 사용 시나리오

**적합한 경우:**
- 새 기능 구현 — 아키텍처 결정이 필요
- 여러 실행 가능한 방안이 존재 — 사용자 선택이 필요
- 코드 변경이 기존 동작이나 구조에 영향
- 다중 파일 변경 — 2~3개 이상의 파일에 걸칠 가능성
- 요구사항이 불명확 — 먼저 탐색하여 범위를 이해해야 함
- 사용자 선호가 중요 — 구현에 여러 합리적인 방향이 있음

**적합하지 않은 경우:**
- 1줄 또는 소수 줄의 수정 (오타, 명백한 버그)
- 사용자가 매우 구체적인 지시를 제공한 경우
- 순수 조사/탐색 태스크 — Task (Explore 타입)를 사용해야 함

## 계획 모드에서의 동작

계획 모드에 진입하면 Claude Code는:
1. Glob, Grep, Read 도구를 사용하여 코드베이스를 깊이 탐색
2. 기존 패턴과 아키텍처를 이해
3. 구현 방안을 설계
4. 방안을 사용자 승인에 제출
5. 필요 시 AskUserQuestion으로 확인
6. 방안이 준비되면 ExitPlanMode로 종료

## 주의사항

- 이 도구는 계획 모드 진입을 위해 사용자 동의가 필요
- 계획이 필요한지 확실하지 않으면 계획하는 쪽으로 기울일 것 — 사전 조율이 재작업보다 나음

## cc-viewer에서의 의의

EnterPlanMode 호출은 요청 로그에서 `tool_use` content block으로 나타납니다. 계획 모드 진입 후의 요청 시퀀스는 보통 탐색적 도구 호출 (Glob, Grep, Read)이 중심이 되며, ExitPlanMode가 호출될 때까지 계속됩니다.

## 원문

<textarea readonly>Use this tool proactively when you're about to start a non-trivial implementation task. Getting user sign-off on your approach before writing code prevents wasted effort and ensures alignment. This tool transitions you into plan mode where you can explore the codebase and design an implementation approach for user approval.

## When to Use This Tool

**Prefer using EnterPlanMode** for implementation tasks unless they're simple. Use it when ANY of these conditions apply:

1. **New Feature Implementation**: Adding meaningful new functionality
   - Example: "Add a logout button" - where should it go? What should happen on click?
   - Example: "Add form validation" - what rules? What error messages?

2. **Multiple Valid Approaches**: The task can be solved in several different ways
   - Example: "Add caching to the API" - could use Redis, in-memory, file-based, etc.
   - Example: "Improve performance" - many optimization strategies possible

3. **Code Modifications**: Changes that affect existing behavior or structure
   - Example: "Update the login flow" - what exactly should change?
   - Example: "Refactor this component" - what's the target architecture?

4. **Architectural Decisions**: The task requires choosing between patterns or technologies
   - Example: "Add real-time updates" - WebSockets vs SSE vs polling
   - Example: "Implement state management" - Redux vs Context vs custom solution

5. **Multi-File Changes**: The task will likely touch more than 2-3 files
   - Example: "Refactor the authentication system"
   - Example: "Add a new API endpoint with tests"

6. **Unclear Requirements**: You need to explore before understanding the full scope
   - Example: "Make the app faster" - need to profile and identify bottlenecks
   - Example: "Fix the bug in checkout" - need to investigate root cause

7. **User Preferences Matter**: The implementation could reasonably go multiple ways
   - If you would use AskUserQuestion to clarify the approach, use EnterPlanMode instead
   - Plan mode lets you explore first, then present options with context

## When NOT to Use This Tool

Only skip EnterPlanMode for simple tasks:
- Single-line or few-line fixes (typos, obvious bugs, small tweaks)
- Adding a single function with clear requirements
- Tasks where the user has given very specific, detailed instructions
- Pure research/exploration tasks (use the Agent tool with explore agent instead)

## What Happens in Plan Mode

In plan mode, you'll:
1. Thoroughly explore the codebase using Glob, Grep, and Read tools
2. Understand existing patterns and architecture
3. Design an implementation approach
4. Present your plan to the user for approval
5. Use AskUserQuestion if you need to clarify approaches
6. Exit plan mode with ExitPlanMode when ready to implement

## Examples

### GOOD - Use EnterPlanMode:
User: "Add user authentication to the app"
- Requires architectural decisions (session vs JWT, where to store tokens, middleware structure)

User: "Optimize the database queries"
- Multiple approaches possible, need to profile first, significant impact

User: "Implement dark mode"
- Architectural decision on theme system, affects many components

User: "Add a delete button to the user profile"
- Seems simple but involves: where to place it, confirmation dialog, API call, error handling, state updates

User: "Update the error handling in the API"
- Affects multiple files, user should approve the approach

### BAD - Don't use EnterPlanMode:
User: "Fix the typo in the README"
- Straightforward, no planning needed

User: "Add a console.log to debug this function"
- Simple, obvious implementation

User: "What files handle routing?"
- Research task, not implementation planning

## Important Notes

- This tool REQUIRES user approval - they must consent to entering plan mode
- If unsure whether to use it, err on the side of planning - it's better to get alignment upfront than to redo work
- Users appreciate being consulted before significant changes are made to their codebase
</textarea>
