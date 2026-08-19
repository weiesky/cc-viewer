# Teammate

## 정의

Teammate는 Claude Code Agent Team 모드에서의 협업 agent입니다. 메인 agent가 `TeamCreate`로 팀을 생성하고 `Agent` 도구로 teammate를 생성하면, 각 teammate는 독립적인 agent 프로세스로 실행되며, 자체 컨텍스트 윈도우와 도구 세트를 가지고 `SendMessage`를 통해 팀 멤버와 통신합니다.

## SubAgent와의 차이점

| 특징 | Teammate | SubAgent |
|------|----------|----------|
| 생명주기 | 지속적으로 존재하며, 여러 번 메시지 수신 가능 | 일회성 작업, 완료 후 소멸 |
| 통신 방식 | SendMessage 양방향 메시지 | 부모→자식 단방향 호출, 결과 반환 |
| 컨텍스트 | 독립적인 완전한 컨텍스트, 턴 간 유지 | 격리된 작업 컨텍스트 |
| 협업 모델 | 팀 협업, 상호 통신 가능 | 계층 구조, 부모 agent와만 상호작용 |
| 작업 유형 | 복잡한 다단계 작업 | 검색, 탐색 등 단일 작업 |

## 동작

- 메인 agent(team lead)가 `Agent` 도구로 생성하고 `team_name`을 할당
- `TaskList` / `TaskGet` / `TaskUpdate`를 통해 작업 목록 공유
- 매 턴 실행 완료 후 idle 상태로 진입하여 새 메시지의 깨움을 대기
- `shutdown_request`를 통해 정상 종료 가능

## 통계 패널 설명

Teammate 통계 패널은 각 teammate의 API 호출 횟수를 표시합니다. `Name` 열은 teammate 이름(예: `reviewer-security`, `reviewer-pipeline`)이며, `횟수` 열은 해당 teammate가 발생시킨 API 요청 총 수입니다.
