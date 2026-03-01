# TaskList

## 정의

태스크 리스트의 모든 태스크를 나열하여 전체 진행 상황과 사용 가능한 작업을 확인합니다.

## 파라미터

파라미터 없음.

## 반환 내용

각 태스크의 요약 정보:
- `id` — 태스크 식별자
- `subject` — 짧은 설명
- `status` — 상태: `pending`, `in_progress` 또는 `completed`
- `owner` — 담당자 (agent ID), 비어 있으면 미할당
- `blockedBy` — 이 태스크를 차단하는 미완료 태스크 ID 목록

## 사용 시나리오

**적합한 경우:**
- 사용 가능한 태스크 확인 (상태가 pending, owner 없음, 차단되지 않음)
- 프로젝트 전체 진행 상황 확인
- 차단된 태스크 검색
- 태스크 완료 후 다음 태스크 검색

## 주의사항

- ID 순서대로 태스크를 처리하는 것을 우선 (최소 ID 우선). 초기 태스크가 보통 후속 태스크에 컨텍스트를 제공하기 때문
- `blockedBy`가 있는 태스크는 의존이 해제될 때까지 인수할 수 없음
- TaskGet으로 특정 태스크의 전체 상세 정보 획득

## cc-viewer에서의 의의

TaskList는 내부 태스크 관리 작업이며, 독립적인 API 요청을 생성하지 않습니다.

## 원문

<textarea readonly>Use this tool to list all tasks in the task list.

## When to Use This Tool

- To see what tasks are available to work on (status: 'pending', no owner, not blocked)
- To check overall progress on the project
- To find tasks that are blocked and need dependencies resolved
- After completing a task, to check for newly unblocked work or claim the next available task
- **Prefer working on tasks in ID order** (lowest ID first) when multiple tasks are available, as earlier tasks often set up context for later ones

## Output

Returns a summary of each task:
- **id**: Task identifier (use with TaskGet, TaskUpdate)
- **subject**: Brief description of the task
- **status**: 'pending', 'in_progress', or 'completed'
- **owner**: Agent ID if assigned, empty if available
- **blockedBy**: List of open task IDs that must be resolved first (tasks with blockedBy cannot be claimed until dependencies resolve)

Use TaskGet with a specific task ID to view full details including description and comments.
</textarea>
