# Agent

## 정의

서브 agent (SubAgent)를 시작하여 복잡한 다단계 태스크를 자율적으로 처리합니다. 서브 agent는 독립된 서브프로세스로, 각각 전용 도구 세트와 컨텍스트를 가집니다. Agent는 최신 Claude Code 버전에서 Task 도구의 이름이 변경된 버전입니다.

## 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `prompt` | string | 예 | 서브 agent가 실행할 태스크 설명 |
| `description` | string | 예 | 3~5단어의 짧은 요약 |
| `subagent_type` | string | 예 | 서브 agent 타입, 사용 가능한 도구 세트를 결정 |
| `model` | enum | 아니오 | 모델 지정 (sonnet / opus / haiku), 기본값은 부모로부터 상속 |
| `max_turns` | integer | 아니오 | 최대 agentic 턴 수 |
| `run_in_background` | boolean | 아니오 | 백그라운드 실행 여부. 백그라운드 태스크는 output_file 경로를 반환 |
| `resume` | string | 아니오 | 재개할 agent ID, 이전 실행에서 계속. 컨텍스트를 잃지 않고 이전 서브 agent를 이어받는 데 유용 |
| `isolation` | enum | 아니오 | 격리 모드, `worktree`로 임시 git worktree 생성 |

## 서브 agent 타입

| 타입 | 용도 | 사용 가능한 도구 |
|------|------|------------------|
| `Bash` | 명령 실행, git 작업 | Bash |
| `general-purpose` | 범용 다단계 태스크 | 전체 도구 |
| `Explore` | 코드베이스 빠른 탐색 | Agent/Edit/Write/NotebookEdit/ExitPlanMode 외 모든 도구 |
| `Plan` | 구현 방안 설계 | Agent/Edit/Write/NotebookEdit/ExitPlanMode 외 모든 도구 |
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
- 단일 메시지 내에서 여러 병렬 Agent 호출을 발행하여 효율 향상 가능
- 백그라운드 태스크는 TaskOutput 도구로 진행 상황 확인
- Explore 타입은 직접 Glob/Grep 호출보다 느리므로, 단순 검색으로 충분하지 않을 때만 사용
- 장시간 실행되며 즉시 결과가 필요 없는 태스크에는 `run_in_background: true` 권장; 결과가 필요한 경우 포그라운드(기본값) 사용
- `resume` 파라미터를 통해 이전에 시작한 서브 agent 세션을 계속할 수 있으며, 축적된 컨텍스트를 유지

## cc-viewer에서의 의의

Agent는 최신 Claude Code 버전에서 Task 도구의 새 이름입니다. Agent 호출은 SubAgent 요청 체인을 생성하며, 요청 목록에서 MainAgent와 독립된 서브 요청 시퀀스로 확인할 수 있습니다. SubAgent 요청은 보통 간결한 system prompt와 적은 도구 정의를 가지며, MainAgent와 뚜렷한 대비를 이룹니다. cc-viewer에서는 기록된 대화에서 사용된 Claude Code 버전에 따라 `Task` 또는 `Agent` 도구 이름이 표시될 수 있습니다.
