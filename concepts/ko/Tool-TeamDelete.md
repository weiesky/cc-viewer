# TeamDelete

## 정의

다중 agent 협업 작업이 완료되었을 때 팀과 관련 태스크 디렉토리를 제거합니다. TeamCreate의 정리 대응 작업입니다.

## 동작

- 팀 디렉토리 제거: `~/.claude/teams/{team-name}/`
- 태스크 디렉토리 제거: `~/.claude/tasks/{team-name}/`
- 현재 세션에서 팀 컨텍스트 초기화

**중요**: 팀에 아직 활성 멤버가 있으면 TeamDelete는 실패합니다. SendMessage 종료 요청을 통해 먼저 모든 팀원을 정상적으로 종료해야 합니다.

## 일반적인 사용 방법

TeamDelete는 팀 워크플로우 종료 시 호출됩니다:

1. 모든 태스크 완료
2. `SendMessage`로 `shutdown_request`를 보내 팀원 종료
3. **TeamDelete**가 팀과 태스크 디렉토리 제거

## 관련 도구

| 도구 | 용도 |
|------|------|
| `TeamCreate` | 새 팀과 태스크 목록 생성 |
| `SendMessage` | 팀원과의 통신 / 종료 요청 전송 |
| `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` | 공유 태스크 목록 관리 |
| `Agent` | 팀에 합류하는 팀원 생성 |
