# TaskList

현재 팀 (또는 세션)의 모든 작업을 요약 형태로 반환합니다. 미결 작업을 조사하고, 다음에 무엇을 선택할지 결정하고, 중복 생성을 피하는 데 사용합니다.

## 사용 시점

- 세션 시작 시 이미 추적되는 것을 보기 위해.
- `TaskCreate`를 호출하기 전에 작업이 이미 캡처되지 않았는지 확인하기 위해.
- 팀원이나 서브에이전트로서 다음에 어떤 작업을 주장할지 결정할 때.
- 팀 전반의 의존성 관계를 한눈에 확인하기 위해.
- 긴 세션 동안 주기적으로 작업을 주장, 완료, 또는 추가한 팀원과 재동기화하기 위해.

`TaskList`는 읽기 전용이며 저렴합니다. 개요가 필요할 때마다 자유롭게 호출하십시오.

## 활성화

- 대부분의 모델에서 기본적으로 사용할 수 있습니다.
- Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 및 이후 제품군(v2.1.233+)에서는 `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools`, 또는 `--tools`로 옵트인하지 않는 한 사용할 수 없습니다.
- `CLAUDE_CODE_ENABLE_TASKS=false`이면 전체 작업 시스템이 비활성화됩니다.

## 매개변수

`TaskList`는 매개변수를 받지 않습니다. 항상 활성 컨텍스트의 전체 작업 집합을 반환합니다.

## 응답 형식

목록의 각 작업은 전체 기록이 아닌 요약입니다. 대략 다음을 기대하십시오:

- `id` — `TaskGet` / `TaskUpdate`와 함께 사용할 안정적인 식별자.
- `subject` — 짧은 명령형 제목.
- `status` — `pending`, `in_progress`, `completed`, `deleted` 중 하나.
- `owner` — 에이전트나 팀원 핸들, 또는 주장되지 않은 경우 비어 있음.
- `blockedBy` — 먼저 완료되어야 하는 작업 ID 배열.

특정 작업의 전체 설명, 수락 기준, 또는 메타데이터의 경우 `TaskGet`으로 후속 작업을 진행하십시오.

## 예시

### 예시 1

빠른 상태 확인.

```
TaskList()
```

`owner` 없는 `in_progress` (오래된 작업)와 `blockedBy`가 비어 있는 `pending` (선택 가능)을 출력에서 스캔하십시오.

### 예시 2

다음 작업을 선택하는 팀원.

```
TaskList()
# Filter to: status == pending AND blockedBy is empty AND owner is empty.
# Among those, prefer the lower ID (tasks are typically numbered in
# creation order, so lower IDs are older and usually higher priority).
TaskGet(taskId: "<chosen id>")
TaskUpdate(taskId: "<chosen id>", status: "in_progress", owner: "<your handle>")
```

## 참고사항

- 팀원 휴리스틱: 여러 `pending` 작업이 차단되지 않고 소유되지 않은 경우 가장 낮은 ID를 선택하십시오. 이것은 작업을 FIFO로 유지하고 두 에이전트가 동일한 주목받는 작업을 잡는 것을 방지합니다.
- `blockedBy`를 존중하십시오: 블로커가 여전히 `pending`이나 `in_progress`인 작업을 시작하지 마십시오. 먼저 블로커를 작업하거나 소유자와 협력하십시오.
- `TaskList`는 작업을 발견하는 유일한 메커니즘입니다. 검색이 없습니다. 목록이 길면 구조적으로 (상태별, 그다음 소유자별) 스캔하십시오.
- 삭제된 작업은 추적 가능성을 위해 상태 `deleted`로 목록에 여전히 나타날 수 있습니다. 계획 목적으로 무시하십시오.
- 목록은 팀의 실시간 상태를 반영하므로 팀원이 호출 간에 작업을 추가하거나 주장할 수 있습니다. 시간이 경과한 경우 주장 전에 다시 나열하십시오.
