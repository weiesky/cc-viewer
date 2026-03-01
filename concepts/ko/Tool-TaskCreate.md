# TaskCreate

## 정의

구조화된 태스크 리스트 항목을 생성하여 진행 상황 추적, 복잡한 태스크 정리, 사용자에게 작업 진행 상황 표시에 사용합니다.

## 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `subject` | string | 예 | 짧은 태스크 제목, 명령형 사용 (예: "Fix authentication bug") |
| `description` | string | 예 | 상세 설명, 컨텍스트와 수락 기준 포함 |
| `activeForm` | string | 아니오 | 진행 중 표시할 현재 진행형 텍스트 (예: "Fixing authentication bug") |
| `metadata` | object | 아니오 | 태스크에 첨부할 임의의 메타데이터 |

## 사용 시나리오

**적합한 경우:**
- 복잡한 다단계 태스크 (3단계 이상)
- 사용자가 여러 할 일 항목을 제공한 경우
- 계획 모드에서 작업 추적
- 사용자가 명시적으로 todo 리스트 사용을 요청

**적합하지 않은 경우:**
- 단일 간단한 태스크
- 3단계 이내의 간단한 작업
- 순수 대화 또는 정보 조회

## 주의사항

- 모든 새 태스크의 초기 상태는 `pending`
- `subject`는 명령형 ("Run tests"), `activeForm`은 현재 진행형 ("Running tests") 사용
- 생성 후 TaskUpdate로 의존 관계 (blocks/blockedBy) 설정 가능
- 생성 전 TaskList를 호출하여 중복 태스크가 없는지 확인해야 함

## cc-viewer에서의 의의

TaskCreate는 Claude Code 내부의 태스크 관리 작업이며, 독립적인 API 요청을 생성하지 않습니다. 다만 Chat Mode에서 모델이 이 도구를 호출한 tool_use block을 확인할 수 있습니다.

## 원문

<textarea readonly>Use this tool to create a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

## When to Use This Tool

Use this tool proactively in these scenarios:

- Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
- Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
- Plan mode - When using plan mode, create a task list to track the work
- User explicitly requests todo list - When the user directly asks you to use the todo list
- User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
- After receiving new instructions - Immediately capture user requirements as tasks
- When you start working on a task - Mark it as in_progress BEFORE beginning work
- After completing a task - Mark it as completed and add any new follow-up tasks discovered during implementation

## When NOT to Use This Tool

Skip using this tool when:
- There is only a single, straightforward task
- The task is trivial and tracking it provides no organizational benefit
- The task can be completed in less than 3 trivial steps
- The task is purely conversational or informational

NOTE that you should not use this tool if there is only one trivial task to do. In this case you are better off just doing the task directly.

## Task Fields

- **subject**: A brief, actionable title in imperative form (e.g., "Fix authentication bug in login flow")
- **description**: Detailed description of what needs to be done, including context and acceptance criteria
- **activeForm**: Present continuous form shown in spinner when task is in_progress (e.g., "Fixing authentication bug"). This is displayed to the user while you work on the task.

**IMPORTANT**: Always provide activeForm when creating tasks. The subject should be imperative ("Run tests") while activeForm should be present continuous ("Running tests"). All tasks are created with status `pending`.

## Tips

- Create tasks with clear, specific subjects that describe the outcome
- Include enough detail in the description for another agent to understand and complete the task
- After creating tasks, use TaskUpdate to set up dependencies (blocks/blockedBy) if needed
- Check TaskList first to avoid creating duplicate tasks
</textarea>
