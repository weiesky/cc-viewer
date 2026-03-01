# TaskOutput

## 정의

실행 중이거나 완료된 백그라운드 태스크의 출력을 가져옵니다. 백그라운드 셸, 비동기 agent, 원격 세션에 적용됩니다.

## 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `task_id` | string | 예 | 태스크 ID |
| `block` | boolean | 예 | 태스크 완료까지 블로킹 대기 여부, 기본값 `true` |
| `timeout` | number | 예 | 최대 대기 시간 (밀리초), 기본값 30000, 최대 600000 |

## 사용 시나리오

**적합한 경우:**
- Task (`run_in_background: true`)로 시작한 백그라운드 agent의 진행 상황 확인
- 백그라운드 Bash 명령의 실행 결과 획득
- 비동기 태스크 완료를 기다리고 출력 획득

**적합하지 않은 경우:**
- 포그라운드 태스크 — 포그라운드 태스크는 직접 결과를 반환하므로 이 도구가 불필요

## 주의사항

- `block: true`는 태스크 완료 또는 타임아웃까지 블로킹
- `block: false`는 논블로킹으로 현재 상태 확인
- 태스크 ID는 `/tasks` 명령으로 검색 가능
- 모든 태스크 타입에 적용: 백그라운드 셸, 비동기 agent, 원격 세션

## cc-viewer에서의 의의

TaskOutput 호출 자체는 API 요청을 생성하지 않습니다. Claude Code 내부의 태스크 관리 작업이며, 요청 로그에 표시되지 않습니다.

## 원문

<textarea readonly>- Retrieves output from a running or completed task (background shell, agent, or remote session)
- Takes a task_id parameter identifying the task
- Returns the task output along with status information
- Use block=true (default) to wait for task completion
- Use block=false for non-blocking check of current status
- Task IDs can be found using the /tasks command
- Works with all task types: background shells, async agents, and remote sessions</textarea>
