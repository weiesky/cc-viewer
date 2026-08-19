# TodoWrite

현재 세션에 대한 구조화된 todo 리스트를 작성하며, 이전 리스트를 대체합니다. 각 항목은 텍스트, 상태, 그리고 진행 표시기에 표시되는 현재 진행형 표현을 가집니다.

## 사용 시점

- 태스크에 여러 개의 뚜렷한 단계가 있고 이를 추적하면 여러분(과 사용자)이 진행 상황을 파악하는 데 도움이 됩니다.
- 사용자가 명시적으로 todo 리스트를 요청합니다.
- 정확히 한 항목만 진행 중으로 표시하고 나머지는 대기 중 또는 완료로 유지하려고 합니다.

## 활성화

- 레거시 도구: 태스크 도구(`TaskCreate`, `TaskUpdate`, `TaskList`)를 제공하는 세션에서는 기본적으로 비활성화됩니다.
- `CLAUDE_CODE_ENABLE_TASKS=0`으로 다시 활성화할 수 있습니다.

## 매개변수

- `todos` (array, 필수): 갱신된 전체 todo 리스트. 각 항목은 다음을 가집니다:
  - `content` (string): 태스크 설명.
  - `status` (string): `pending`, `in_progress`, `completed` 중 하나.
  - `activeForm` (string): 항목이 진행 중일 때 표시되는 현재 진행형 텍스트 (예: "Running tests").

## 예시

### 예시 1: 세 단계 변경 추적

```
TodoWrite(
  todos=[
    {content="Update the parser", status="in_progress", activeForm="Updating the parser"},
    {content="Add unit tests", status="pending", activeForm="Adding unit tests"},
    {content="Run the full test suite", status="pending", activeForm="Running the full test suite"}
  ]
)
```

모든 호출에서 전체 리스트가 다시 작성됩니다 — 변경된 항목만이 아니라 항상 모든 항목을 포함하십시오.

## 참고사항

- 리스트는 각 호출마다 통째로 대체됩니다. 한 항목을 업데이트하려면 새 상태로 모든 항목을 다시 제출하십시오.
- 한 번에 정확히 하나의 항목만 `in_progress`로 유지하십시오.
- 구조화된 태스크 도구(`TaskCreate`/`TaskUpdate`/`TaskList`)가 활성화된 세션에서는 하니스가 `TodoWrite` 대신 그것들을 제공할 수 있습니다 — 광고된 도구 세트를 우선 사용하십시오.
