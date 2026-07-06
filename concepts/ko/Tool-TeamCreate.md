# TeamCreate

## 정의

프로젝트를 진행하는 여러 agent를 조율하는 새로운 팀을 생성합니다. 팀은 공유 태스크 목록과 agent 간 메시지 교환을 통해 병렬 태스크 실행을 가능하게 합니다.

## 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `team_name` | string | 예 | 새 팀의 이름 |
| `description` | string | 아니오 | 팀 설명 / 목적 |
| `agent_type` | string | 아니오 | 팀 리더의 타입 / 역할 |

## 생성되는 항목

- **팀 설정 파일**: `~/.claude/teams/{team-name}/config.json` — 멤버 목록과 메타데이터 저장
- **태스크 목록 디렉토리**: `~/.claude/tasks/{team-name}/` — 모든 팀원이 공유하는 태스크 목록

팀과 태스크 목록은 1:1 대응 관계입니다.

## 팀 워크플로우

1. **TeamCreate** — 팀과 태스크 목록 생성
2. **TaskCreate** — 팀의 태스크 정의
3. **Agent** (`team_name` + `name` 지정) — 팀에 합류하는 팀원 생성
4. **TaskUpdate** — `owner`를 통해 팀원에게 태스크 할당
5. 팀원들이 태스크를 수행하며 **SendMessage**로 소통
6. 완료 후 팀원 종료, 이후 **TeamDelete**로 정리

## 관련 도구

| 도구 | 용도 |
|------|------|
| `TeamDelete` | 팀과 태스크 디렉토리 제거 |
| `SendMessage` | 팀 내 agent 간 통신 |
| `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` | 공유 태스크 목록 관리 |
| `Agent` | 팀에 합류하는 팀원 생성 |
