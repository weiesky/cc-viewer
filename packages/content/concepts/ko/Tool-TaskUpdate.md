# TaskUpdate

기존 작업 — 상태, 내용, 소유권, 메타데이터, 또는 의존성 에지 — 을 수정합니다. 이것은 작업이 수명 주기를 통해 진행되고 Claude Code, 팀원, 서브에이전트 간에 작업이 전달되는 방식입니다.

## 사용 시점

- 작업을 진행할 때 상태 워크플로를 통해 작업을 전환합니다.
- 자신 (또는 다른 에이전트)을 `owner`로 할당하여 작업을 주장합니다.
- 문제에 대해 더 많이 알게 되면 `subject` 또는 `description`을 개선합니다.
- `addBlocks` / `addBlockedBy`로 새로 발견된 의존성을 기록합니다.
- 외부 티켓 ID나 우선순위 힌트와 같은 구조화된 `metadata`를 첨부합니다.

## 활성화

- 대부분의 모델에서 기본적으로 사용할 수 있습니다.
- Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 및 이후 제품군(v2.1.233+)에서는 `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools`, 또는 `--tools`로 옵트인하지 않는 한 사용할 수 없습니다.
- `CLAUDE_CODE_ENABLE_TASKS=false`이면 전체 작업 시스템이 비활성화됩니다.

## 매개변수

- `taskId` (string, 필수): 수정할 작업. `TaskList`나 `TaskCreate`에서 얻습니다.
- `status` (string, 선택): `pending`, `in_progress`, `completed`, `deleted` 중 하나.
- `subject` (string, 선택): 교체할 명령형 제목.
- `description` (string, 선택): 교체할 상세한 설명.
- `activeForm` (string, 선택): 교체할 현재 진행형 스피너 텍스트.
- `owner` (string, 선택): 작업에 대한 책임을 맡는 에이전트나 팀원 핸들.
- `metadata` (object, 선택): 작업에 병합할 메타데이터 키. 키를 `null`로 설정하여 삭제합니다.
- `addBlocks` (array of strings, 선택): 이 작업이 차단하는 작업 ID.
- `addBlockedBy` (array of strings, 선택): 이 작업 전에 완료되어야 하는 작업 ID.

## 상태 워크플로

수명 주기는 의도적으로 선형입니다: `pending` → `in_progress` → `completed`. `deleted`는 종결되며 절대 작업되지 않을 작업을 취소하는 데 사용됩니다.

- 실제로 작업을 시작하는 순간에 `in_progress`로 설정하십시오. 주어진 소유자에 대해 한 번에 하나의 작업만 `in_progress`여야 합니다.
- 작업이 완전히 완료된 경우에만 `completed`로 설정하십시오 — 수락 기준 충족, 테스트 통과, 출력 작성. 블로커가 나타나면 작업을 `in_progress`로 유지하고 해결해야 할 것을 설명하는 새 작업을 추가하십시오.
- 테스트가 실패하거나 구현이 부분적이거나 해결되지 않은 오류에 부딪힐 때 작업을 `completed`로 표시하지 마십시오.
- 취소되거나 중복된 작업에는 `deleted`를 사용하십시오. 관련 없는 작업을 위해 작업을 재활용하지 마십시오.

## 예시

### 예시 1

작업을 주장하고 시작합니다.

```
TaskUpdate(
  taskId: "t_01HXYZ...",
  status: "in_progress",
  owner: "main-agent"
)
```

### 예시 2

작업을 완료하고 후속 의존성을 기록합니다.

```
TaskUpdate(
  taskId: "t_01HXYZ...",
  status: "completed"
)

TaskUpdate(
  taskId: "t_01FOLLOWUP...",
  addBlockedBy: ["t_01HXYZ..."]
)
```

## 참고사항

- `metadata`는 키별로 병합됩니다. 키에 대해 `null`을 전달하면 제거됩니다. 현재 내용에 대해 확신이 없으면 먼저 `TaskGet`을 호출하십시오.
- `addBlocks`와 `addBlockedBy`는 에지를 추가합니다. 기존 것을 제거하지 않습니다. 그래프를 파괴적으로 편집하려면 전용 워크플로가 필요합니다 — 의존성을 다시 작성하기 전에 팀 소유자와 상의하십시오.
- `subject`를 변경할 때 `activeForm`을 동기화 상태로 유지하여 스피너 텍스트가 계속 자연스럽게 읽히도록 하십시오.
- 작업을 조용히 하기 위해 `completed`로 표시하지 마십시오. 사용자가 작업을 취소한 경우 `description`에 간단한 근거와 함께 `deleted`를 사용하십시오.
- 업데이트 전에 `TaskGet`으로 작업의 최신 상태를 읽으십시오 — 팀원이 마지막 읽기와 쓰기 사이에 변경했을 수 있습니다.
