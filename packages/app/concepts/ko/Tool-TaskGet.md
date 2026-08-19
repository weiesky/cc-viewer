# TaskGet

ID로 단일 작업의 전체 기록을 가져옵니다. 설명, 현재 상태, 소유자, 메타데이터, 의존성 에지를 포함합니다. `TaskList`에서 반환된 요약이 작업에 대해 행동하기에 충분하지 않을 때 사용합니다.

## 사용 시점

- `TaskList`에서 작업을 선택했고 시작하기 전에 전체 설명이 필요합니다.
- 작업을 `completed`로 표시하려고 하며 수락 기준을 다시 확인하고 싶습니다.
- 이 작업이 `blocks`하거나 `blockedBy`인 작업을 검사하여 다음 조치를 결정해야 합니다.
- 기록을 조사하고 있습니다 — 누가 소유하는지, 어떤 메타데이터가 첨부되었는지, 언제 상태가 변경되었는지.
- 팀원이나 이전 세션이 작업 ID를 참조했고 컨텍스트가 필요합니다.

고수준 스캔만 필요할 때는 `TaskList`를 선호하십시오. `TaskGet`은 주의 깊게 읽거나 수정하려는 특정 기록에 예약하십시오.

## 활성화

- 대부분의 모델에서 기본적으로 사용할 수 있습니다.
- Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 및 이후 제품군(v2.1.233+)에서는 `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools`, 또는 `--tools`로 옵트인하지 않는 한 사용할 수 없습니다.
- `CLAUDE_CODE_ENABLE_TASKS=false`이면 전체 작업 시스템이 비활성화됩니다.

## 매개변수

- `taskId` (string, 필수): `TaskCreate`나 `TaskList`에서 반환된 작업 식별자. ID는 작업의 수명 동안 안정적입니다.

## 예시

### 예시 1

방금 목록에서 본 작업을 조회합니다.

```
TaskGet(taskId: "t_01HXYZ...")
```

일반적인 응답 필드: `id`, `subject`, `description`, `activeForm`, `status`, `owner`, `blocks`, `blockedBy`, `metadata`, `createdAt`, `updatedAt`.

### 예시 2

시작하기 전에 의존성을 해결합니다.

```
TaskGet(taskId: "t_01HXYZ...")
# Inspect blockedBy — if any referenced task is still pending
# or in_progress, work on the blocker first.
```

## 참고사항

- `TaskGet`은 읽기 전용이며 반복적으로 호출해도 안전합니다. 상태나 소유권을 변경하지 않습니다.
- `blockedBy`가 비어 있지 않고 `completed`가 아닌 작업을 포함하는 경우 이 작업을 시작하지 마십시오 — 먼저 블로커를 해결하거나 (또는 소유자와 협력하십시오).
- `description` 필드가 길 수 있습니다. 행동하기 전에 완전히 읽으십시오. 훑어보는 것은 놓친 수락 기준으로 이어집니다.
- 알 수 없거나 삭제된 `taskId`는 오류를 반환합니다. 현재 ID를 선택하려면 `TaskList`를 다시 실행하십시오.
- 작업을 편집하려고 한다면 팀원이 방금 변경한 필드를 덮어쓰지 않도록 먼저 `TaskGet`을 호출하십시오.
