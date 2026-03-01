# TaskGet

## 정의

태스크 ID로 태스크의 전체 상세 정보를 가져옵니다.

## 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `taskId` | string | 예 | 가져올 태스크 ID |

## 반환 내용

- `subject` — 태스크 제목
- `description` — 상세 요구사항과 컨텍스트
- `status` — 상태: `pending`, `in_progress` 또는 `completed`
- `blocks` — 이 태스크에 의해 차단된 태스크 목록
- `blockedBy` — 이 태스크를 차단하는 선행 태스크 목록

## 사용 시나리오

**적합한 경우:**
- 작업 시작 전 태스크의 전체 설명과 컨텍스트 획득
- 태스크의 의존 관계 이해
- 태스크를 할당받은 후 전체 요구사항 획득

## 주의사항

- 태스크 획득 후 작업 시작 전에 `blockedBy` 목록이 비어 있는지 확인해야 함
- TaskList로 모든 태스크의 요약 정보 확인

## cc-viewer에서의 의의

TaskGet은 내부 태스크 관리 작업이며, 독립적인 API 요청을 생성하지 않습니다.

## 원문

<textarea readonly>Use this tool to retrieve a task by its ID from the task list.

## When to Use This Tool

- When you need the full description and context before starting work on a task
- To understand task dependencies (what it blocks, what blocks it)
- After being assigned a task, to get complete requirements

## Output

Returns full task details:
- **subject**: Task title
- **description**: Detailed requirements and context
- **status**: 'pending', 'in_progress', or 'completed'
- **blocks**: Tasks waiting on this one to complete
- **blockedBy**: Tasks that must complete before this one can start

## Tips

- After fetching a task, verify its blockedBy list is empty before beginning work.
- Use TaskList to see all tasks in summary form.
</textarea>
