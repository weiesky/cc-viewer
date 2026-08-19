# SendMessage

활성화된 팀 내에서 한 팀 멤버에서 다른 팀 멤버로 메시지를 전달하거나, 모든 팀원에게 한 번에 브로드캐스트합니다. 이것은 팀원이 들을 수 있는 유일한 채널입니다 — 일반 텍스트 출력에 쓴 것은 그들에게 보이지 않습니다.

## 사용 시점

- 팀 협업 중에 명명된 팀원에게 작업을 할당하거나 하위 문제를 넘겨줍니다.
- 다른 에이전트로부터 상태, 중간 결과, 또는 코드 리뷰를 요청합니다.
- `*`를 통해 전체 팀에게 결정, 공유 제약 조건, 또는 종료 공지를 브로드캐스트합니다.
- 팀 리더의 종료 요청이나 계획 승인 요청과 같은 프로토콜 프롬프트에 답장합니다.
- 위임된 작업의 끝에서 루프를 닫아 리더가 항목을 완료로 표시할 수 있도록 합니다.

## 활성화

- `ListAgents`와 동일한 세션 간 메시징 조건(서버 측 기능 플래그, 기본적으로 꺼짐)에 의해 게이트됩니다.
- 팀원은 추가로 실험적 에이전트 팀이 활성화되어 있어야 합니다.

## 매개변수

- `to` (string, 필수): 팀에 등록된 대상 팀원의 `name`, 또는 모든 팀원에게 한 번에 브로드캐스트하려면 `*`.
- `message` (string 또는 object, 필수): 일반 통신용 일반 텍스트, 또는 `shutdown_response` 및 `plan_approval_response`와 같은 프로토콜 응답용 구조화된 객체.
- `summary` (string, 선택): 일반 텍스트 메시지에 대한 팀 활동 로그에 표시되는 5-10단어의 미리보기. 긴 문자열 메시지에 필수. `message`가 프로토콜 객체일 때는 무시됩니다.

## 예시

### 예시 1: 직접 작업 핸드오프

```
SendMessage(
  to="db-lead",
  message="Please audit prisma/schema.prisma and list any model missing createdAt/updatedAt timestamps. Reply when done.",
  summary="Audit schema for missing timestamps"
)
```

### 예시 2: 공유 제약 조건 브로드캐스트

```
SendMessage(
  to="*",
  message="Reminder: do not touch files under legacy/ — that subtree is frozen until the migration PR lands.",
  summary="Freeze legacy/ during migration"
)
```

### 예시 3: 프로토콜 응답

구조화된 메시지를 사용하여 리더의 종료 요청에 응답합니다:

```
SendMessage(
  to="leader",
  message={ "type": "shutdown_response", "ready": true, "final_report": "All assigned diff chunks committed on branch refactor-crew/db-lead." }
)
```

### 예시 4: 계획 승인 응답

```
SendMessage(
  to="leader",
  message={ "type": "plan_approval_response", "approved": true, "notes": "LGTM, but please split step 4 into migration + backfill." }
)
```

## 참고사항

- 일반 어시스턴트 텍스트 출력은 팀원에게 전송되지 않습니다. 다른 에이전트가 무언가를 보기를 원한다면 반드시 `SendMessage`를 통해야 합니다. 이것이 팀 워크플로에서 가장 흔한 실수입니다.
- 브로드캐스트 (`to: "*"`)는 비용이 많이 듭니다 — 모든 팀원을 깨우고 컨텍스트를 소비합니다. 진정으로 모두에게 영향을 미치는 공지에만 예약하십시오. 대상 전송을 선호하십시오.
- 메시지를 간결하고 행동 지향적으로 유지하십시오. 수신자가 필요한 파일 경로, 제약 조건, 예상 응답 형식을 포함하십시오. 그들은 당신과 공유 메모리가 없다는 것을 기억하십시오.
- 프로토콜 메시지 객체 (`shutdown_response`, `plan_approval_response`)는 고정된 형태를 가집니다. 프로토콜 필드를 일반 텍스트 메시지에 혼합하거나 그 반대로 하지 마십시오.
- 메시지는 비동기입니다. 수신자는 다음 턴에 당신의 메시지를 받습니다. 그들이 답장할 때까지 읽거나 행동했다고 가정하지 마십시오.
- 잘 작성된 `summary`는 리더를 위해 팀 활동 로그를 스캔 가능하게 만듭니다 — 커밋 제목처럼 다루십시오.
