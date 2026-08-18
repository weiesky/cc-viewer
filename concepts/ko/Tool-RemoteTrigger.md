# RemoteTrigger

claude.ai 원격 트리거 API를 호출하여 예약된 작업과 온디맨드 트리거 실행을 관리합니다. OAuth 토큰은 내부적으로 처리되며 모델이나 셸에 노출되지 않습니다.

## 사용 시점

- claude.ai의 원격 에이전트(트리거) 관리 — 기존 트리거 목록 조회, 검사 및 업데이트 포함
- cron 기반 자동화 작업 생성 — Claude 에이전트가 반복 일정에 따라 실행되도록 설정
- 다음 예약 실행을 기다리지 않고 기존 트리거를 즉시 실행
- 모든 현재 트리거를 나열하거나 감사하여 구성 및 상태 검토
- 트리거를 재생성하지 않고 일정, 페이로드 또는 설명과 같은 트리거 설정 업데이트

## 활성화

- claude.ai Pro, Max, Team, 또는 Enterprise 플랜이 필요합니다.
- Amazon Bedrock, AWS의 Claude Platform, Google Cloud, Microsoft Foundry에서는 사용할 수 없습니다.
- 서버 측 기능 플래그와 `allow_remote_sessions` / `allow_routines` 정책 설정이 필요합니다.
- 원격 세션 자체를 위한 것이 아닙니다.

## 매개변수

- `action` (string, 필수): 수행할 작업 — `list`, `get`, `create`, `update`, `run` 중 하나
- `trigger_id` (string, `get`, `update`, `run` 시 필수): 작업할 트리거의 식별자; 패턴 `^[\w-]+$`(단어 문자 및 대시만 허용)와 일치해야 함
- `body` (object, `create` 및 `update` 시 필수; `run` 시 선택): API에 전송되는 요청 페이로드

## 예시

### 예시 1: 모든 트리거 목록 조회

```json
{
  "action": "list"
}
```

`GET /v1/code/triggers`를 호출하여 인증된 계정과 연결된 모든 트리거의 JSON 배열을 반환합니다.

### 예시 2: 매주 평일 아침에 실행되는 새 트리거 생성

```json
{
  "action": "create",
  "body": {
    "name": "weekday-morning-report",
    "schedule": "0 8 * * 1-5",
    "description": "매주 평일 UTC 08:00에 일일 요약 생성"
  }
}
```

제공된 본문으로 `POST /v1/code/triggers`를 호출하고, 할당된 `trigger_id`를 포함한 새로 생성된 트리거 객체를 반환합니다.

### 예시 3: 온디맨드 트리거 실행

```json
{
  "action": "run",
  "trigger_id": "my-report-trigger"
}
```

예약된 시간을 건너뛰고 즉시 `POST /v1/code/triggers/my-report-trigger/run`을 호출합니다.

### 예시 4: 단일 트리거 조회

```json
{
  "action": "get",
  "trigger_id": "my-report-trigger"
}
```

`GET /v1/code/triggers/my-report-trigger`를 호출하여 전체 트리거 구성을 반환합니다.

## 참고사항

- OAuth 토큰은 도구에 의해 프로세스 내부에서 주입됩니다 — 토큰을 수동으로 복사, 붙여넣기 또는 기록하지 마십시오. 이는 보안 위험을 초래하며 이 도구를 사용할 때는 불필요합니다.
- 모든 트리거 API 호출에는 원시 `curl`이나 다른 HTTP 클라이언트 대신 이 도구를 사용하십시오. 직접 HTTP를 사용하면 보안 토큰 주입을 우회하여 자격 증명이 노출될 수 있습니다.
- 도구는 API의 원시 JSON 응답을 반환합니다. 호출자는 응답을 파싱하고 오류 상태 코드를 처리할 책임이 있습니다.
- `trigger_id` 값은 패턴 `^[\w-]+$`와 일치해야 합니다 — 영숫자 문자, 밑줄, 대시만 허용됩니다. 공백이나 특수 문자가 포함되면 요청이 실패합니다.
