# TaskCreate

현재 팀의 작업 목록 (또는 팀이 활성화되지 않은 경우 세션의 작업 목록)에 새 작업을 생성합니다. 나중에 추적, 위임, 또는 재방문해야 할 작업 항목을 캡처하는 데 사용합니다.

## 사용 시점

- 사용자가 명시적인 추적으로부터 이점을 얻는 다단계 작업을 설명합니다.
- 큰 요청을 별도로 완료 가능한 작은 단위로 분할하고 있습니다.
- 작업 중간에 후속 작업이 발견되었으며 잊지 말아야 합니다.
- 팀원이나 서브에이전트에게 작업을 넘기기 전에 의도에 대한 영속적인 기록이 필요합니다.
- 계획 모드에서 작동 중이며 각 계획 단계를 구체적인 작업으로 표현하려고 합니다.

사소한 일회성 작업, 순수 대화, 또는 두세 번의 직접 도구 호출로 완료 가능한 작업에는 `TaskCreate`를 건너뛰십시오.

## 활성화

- 대부분의 모델에서 기본적으로 사용할 수 있습니다.
- Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 및 이후 제품군(v2.1.233+)에서는 `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools`, 또는 `--tools`로 옵트인하지 않는 한 사용할 수 없습니다.
- `CLAUDE_CODE_ENABLE_TASKS=false`이면 전체 작업 시스템이 비활성화됩니다.

## 매개변수

- `subject` (string, 필수): 짧은 명령형 제목, 예를 들어 `Fix login redirect on Safari`. 대략 80자 미만으로 유지하십시오.
- `description` (string, 필수): 상세한 컨텍스트 — 문제, 제약 조건, 수락 기준, 향후 독자가 필요할 파일이나 링크. 팀원이 이것을 차갑게 집어 드는 것처럼 작성하십시오.
- `activeForm` (string, 선택): 작업이 `in_progress`일 때 표시되는 현재 진행형 스피너 텍스트, 예를 들어 `Fixing login redirect on Safari`. `subject`를 미러링하지만 -ing 형태로.
- `metadata` (object, 선택): 작업에 첨부된 임의의 구조화된 데이터. 일반적인 용도: 레이블, 우선순위 힌트, 외부 티켓 ID, 또는 에이전트별 구성.

새로 생성된 작업은 항상 상태 `pending`으로 시작하며 소유자가 없습니다. 의존성 (`blocks`, `blockedBy`)은 생성 시점에 설정되지 않습니다 — 나중에 `TaskUpdate`로 적용하십시오.

## 예시

### 예시 1

사용자가 방금 제출한 버그 보고서를 캡처합니다.

```
TaskCreate(
  subject: "Repair broken PDF export on Windows",
  description: "Users on Windows 11 report the export button produces a 0-byte file. Reproduce with sample doc in test/fixtures/export/, then fix the code path in src/export/pdf.ts. Acceptance: export writes a valid PDF and the existing export test suite passes.",
  activeForm: "Repairing broken PDF export on Windows"
)
```

### 예시 2

세션 시작 시 에픽을 추적된 단위로 분할합니다.

```
TaskCreate(
  subject: "Draft migration plan for auth service",
  description: "Produce a written plan covering rollout stages, rollback strategy, and monitoring. Output: docs/auth-migration.md.",
  activeForm: "Drafting migration plan for auth service",
  metadata: { "priority": "P1", "linearId": "AUTH-214" }
)
```

## 참고사항

- 작업이 `in_progress`로 전환될 때 UI가 자연스럽게 읽히도록 `subject`는 명령형 어조로, `activeForm`은 현재 진행형으로 작성하십시오.
- 중복을 피하기 위해 생성 전에 `TaskList`를 호출하십시오 — 팀 목록은 팀원 및 서브에이전트와 공유됩니다.
- `description`이나 `metadata`에 비밀이나 자격 증명을 포함하지 마십시오. 작업 기록은 팀에 접근할 수 있는 모든 사람에게 보입니다.
- 생성 후 `TaskUpdate`로 작업을 수명 주기를 통해 이동시키십시오. `in_progress`에 작업을 조용히 방치하지 마십시오.
