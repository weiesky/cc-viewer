# Task

> **참고:** 최신 Claude Code 버전에서 이 도구는 **Agent**로 이름이 변경되었습니다. [Tool-Agent](Tool-Agent) 문서를 참조하세요.

## 정의

서브 agent (SubAgent)를 시작하여 복잡한 다단계 태스크를 자율적으로 처리합니다. 서브 agent는 독립된 서브프로세스로, 각각 전용 도구 세트와 컨텍스트를 가집니다.

## 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `prompt` | string | 예 | 서브 agent가 실행할 태스크 설명 |
| `description` | string | 예 | 3~5단어의 짧은 요약 |
| `subagent_type` | string | 예 | 서브 agent 타입, 사용 가능한 도구 세트를 결정 |
| `model` | enum | 아니오 | 모델 지정 (sonnet / opus / haiku), 기본값은 부모로부터 상속 |
| `max_turns` | integer | 아니오 | 최대 agentic 턴 수 |
| `run_in_background` | boolean | 아니오 | 백그라운드 실행 여부. 백그라운드 태스크는 output_file 경로를 반환 |
| `resume` | string | 아니오 | 재개할 agent ID, 이전 실행에서 계속 |
| `isolation` | enum | 아니오 | 격리 모드, `worktree`로 임시 git worktree 생성 |

## 서브 agent 타입

| 타입 | 용도 | 사용 가능한 도구 |
|------|------|------------------|
| `Bash` | 명령 실행, git 작업 | Bash |
| `general-purpose` | 범용 다단계 태스크 | 전체 도구 |
| `Explore` | 코드베이스 빠른 탐색 | Task/Edit/Write/NotebookEdit/ExitPlanMode 외 모든 도구 |
| `Plan` | 구현 방안 설계 | Task/Edit/Write/NotebookEdit/ExitPlanMode 외 모든 도구 |
| `claude-code-guide` | Claude Code 사용 가이드 Q&A | Glob, Grep, Read, WebFetch, WebSearch |
| `statusline-setup` | 상태 표시줄 설정 | Read, Edit |

## 사용 시나리오

**적합한 경우:**
- 다단계로 자율 완료해야 하는 복잡한 태스크
- 코드베이스 탐색 및 심층 조사 (Explore 타입 사용)
- 격리 환경이 필요한 병렬 작업
- 백그라운드 실행이 필요한 장시간 태스크

**적합하지 않은 경우:**
- 특정 파일 경로 읽기 — 직접 Read 또는 Glob 사용
- 2~3개 알려진 파일 내 검색 — 직접 Read 사용
- 특정 클래스 정의 검색 — 직접 Glob 사용

## 주의사항

- 서브 agent는 완료 후 단일 메시지를 반환하며, 그 결과는 사용자에게 보이지 않으므로 메인 agent가 전달해야 함
- 단일 메시지 내에서 여러 병렬 Task 호출을 발행하여 효율 향상 가능
- 백그라운드 태스크는 TaskOutput 도구로 진행 상황 확인
- Explore 타입은 직접 Glob/Grep 호출보다 느리므로, 단순 검색으로 충분하지 않을 때만 사용
