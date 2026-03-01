# TaskUpdate

## 정의

태스크 리스트 내 특정 태스크의 상태, 내용 또는 의존 관계를 업데이트합니다.

## 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `taskId` | string | 예 | 업데이트할 태스크 ID |
| `status` | enum | 아니오 | 새 상태: `pending` / `in_progress` / `completed` / `deleted` |
| `subject` | string | 아니오 | 새 제목 |
| `description` | string | 아니오 | 새 설명 |
| `activeForm` | string | 아니오 | 진행 중 표시할 현재 진행형 텍스트 |
| `owner` | string | 아니오 | 새 태스크 담당자 (agent 이름) |
| `metadata` | object | 아니오 | 병합할 메타데이터 (null로 설정하면 키 삭제) |
| `addBlocks` | string[] | 아니오 | 이 태스크에 의해 차단되는 태스크 ID 목록 |
| `addBlockedBy` | string[] | 아니오 | 이 태스크를 차단하는 선행 태스크 ID 목록 |

## 상태 전이

```
pending → in_progress → completed
```

`deleted`는 모든 상태에서 전이 가능하며, 태스크를 영구 삭제합니다.

## 사용 시나리오

**적합한 경우:**
- 작업 시작 시 태스크를 `in_progress`로 마킹
- 작업 완료 후 태스크를 `completed`로 마킹
- 태스크 간 의존 관계 설정
- 요구사항 변경 시 태스크 내용 업데이트

**중요 규칙:**
- 태스크를 완전히 완료한 경우에만 `completed`로 마킹
- 오류나 차단에 직면하면 `in_progress` 유지
- 테스트 실패, 구현 불완전, 미해결 오류가 있으면 `completed`로 마킹 불가

## 주의사항

- 업데이트 전 TaskGet으로 태스크의 최신 상태를 가져와 오래된 데이터를 피할 것
- 태스크 완료 후 TaskList를 호출하여 다음 사용 가능한 태스크 검색

## cc-viewer에서의 의의

TaskUpdate는 내부 태스크 관리 작업이며, 독립적인 API 요청을 생성하지 않습니다.

## 원문

<textarea readonly>Use this tool to update a task in the task list.

## When to Use This Tool

**Mark tasks as resolved:**
- When you have completed the work described in a task
- When a task is no longer needed or has been superseded
- IMPORTANT: Always mark your assigned tasks as resolved when you finish them
- After resolving, call TaskList to find your next task

- ONLY mark a task as completed when you have FULLY accomplished it
- If you encounter errors, blockers, or cannot finish, keep the task as in_progress
- When blocked, create a new task describing what needs to be resolved
- Never mark a task as completed if:
  - Tests are failing
  - Implementation is partial
  - You encountered unresolved errors
  - You couldn't find necessary files or dependencies

**Delete tasks:**
- When a task is no longer relevant or was created in error
- Setting status to `deleted` permanently removes the task

**Update task details:**
- When requirements change or become clearer
- When establishing dependencies between tasks

## Fields You Can Update

- **status**: The task status (see Status Workflow below)
- **subject**: Change the task title (imperative form, e.g., "Run tests")
- **description**: Change the task description
- **activeForm**: Present continuous form shown in spinner when in_progress (e.g., "Running tests")
- **owner**: Change the task owner (agent name)
- **metadata**: Merge metadata keys into the task (set a key to null to delete it)
- **addBlocks**: Mark tasks that cannot start until this one completes
- **addBlockedBy**: Mark tasks that must complete before this one can start

## Status Workflow

Status progresses: `pending` → `in_progress` → `completed`

Use `deleted` to permanently remove a task.

## Staleness

Make sure to read a task's latest state using `TaskGet` before updating it.

## Examples

Mark task as in progress when starting work:
```json
{"taskId": "1", "status": "in_progress"}
```

Mark task as completed after finishing work:
```json
{"taskId": "1", "status": "completed"}
```

Delete a task:
```json
{"taskId": "1", "status": "deleted"}
```

Claim a task by setting owner:
```json
{"taskId": "1", "owner": "my-name"}
```

Set up task dependencies:
```json
{"taskId": "2", "addBlockedBy": ["1"]}
```
</textarea>
