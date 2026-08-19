# Agent

자체 컨텍스트 창을 갖춘 자율적인 Claude Code 서브에이전트를 생성하여 특정 작업을 처리하고 하나의 통합된 결과를 반환합니다. 이는 개방형 조사, 병렬 작업, 또는 팀 협업을 위임하는 표준적인 메커니즘입니다.

## 사용 시점

- 어떤 파일이 관련 있는지 아직 모르고 `Glob`, `Grep`, `Read`의 여러 라운드가 예상되는 개방형 검색.
- 병렬 독립 작업 — 하나의 메시지에서 여러 에이전트를 실행하여 서로 다른 영역을 동시에 조사합니다.
- 부모 컨텍스트를 간결하게 유지하기 위해 주요 대화로부터 노이즈가 많은 탐색을 분리합니다.
- `Explore`, `Plan`, `claude-code-guide`, `statusline-setup`과 같은 전문화된 서브에이전트 타입에 위임합니다.
- 조율된 다중 에이전트 작업을 위해 활성화된 팀에 명명된 팀원을 생성합니다.

대상 파일이나 심볼을 이미 알고 있는 경우에는 사용하지 마십시오 — `Read`, `Grep`, 또는 `Glob`을 직접 사용하십시오. `Agent`를 통한 한 단계 조회는 전체 컨텍스트 창을 낭비하고 지연 시간을 추가합니다.

## 매개변수

- `description` (string, 필수): 작업을 설명하는 3-5 단어의 짧은 레이블로, UI와 로그에 표시됩니다.
- `prompt` (string, 필수): 에이전트가 실행할 완전하고 자체 포함된 지시사항. 필요한 모든 컨텍스트, 제약 조건, 기대하는 반환 형식을 포함해야 합니다.
- `subagent_type` (string, 선택): `general-purpose`, `Explore`, `Plan`, `claude-code-guide`, `statusline-setup`과 같은 사전 설정 페르소나. 기본값은 `general-purpose`입니다.
- `run_in_background` (boolean, 선택): true인 경우 에이전트가 비동기로 실행되며 부모는 작업을 계속할 수 있습니다. 결과는 나중에 검색됩니다.
- `model` (string, 선택): 이 에이전트에 대한 모델을 재정의합니다 — `opus`, `sonnet`, 또는 `haiku`. 기본값은 부모 세션의 모델입니다.
- `isolation` (string, 선택): 에이전트의 파일시스템 쓰기가 부모와 충돌하지 않도록 격리된 git 워크트리 안에서 에이전트를 실행하려면 `worktree`로 설정합니다.
- `team_name` (string, 선택): 기존 팀에 생성할 때 에이전트가 합류할 팀 식별자.
- `name` (string, 선택): 팀 내에서 주소 지정 가능한 팀원 이름으로, `SendMessage`의 `to` 대상으로 사용됩니다.

## 예시

### 예시 1: 개방형 코드 검색

```
Agent(
  description="Find auth middleware",
  subagent_type="Explore",
  prompt="Locate every place in this repo where JWT verification is performed. Return a bulleted list of absolute file paths with a one-line note about each site's role. Do not modify any files."
)
```

### 예시 2: 병렬 독립 조사

같은 메시지에서 두 개의 에이전트를 실행합니다 — 하나는 빌드 파이프라인을 검사하고, 다른 하나는 테스트 하니스를 검토합니다. 각 에이전트는 자체 컨텍스트 창을 받고 요약을 반환합니다. 단일 도구 호출 블록에서 일괄 실행하면 동시에 실행됩니다.

### 예시 3: 실행 중인 팀에 팀원 생성

```
Agent(
  description="Data layer specialist",
  team_name="refactor-crew",
  name="db-lead",
  prompt="You are db-lead on team refactor-crew. Audit all Prisma schema files and propose a migration plan. Use SendMessage to report findings to the team leader."
)
```

## 참고사항

- 에이전트는 이전 실행의 메모리가 없습니다. 모든 호출은 제로에서 시작하므로 `prompt`는 완전히 자체 포함되어야 합니다 — 파일 경로, 규칙, 질문, 원하는 답변의 정확한 형태를 포함해야 합니다.
- 에이전트는 정확히 하나의 최종 메시지를 반환합니다. 실행 중에 명확한 질문을 할 수 없으므로 프롬프트의 모호함은 결과에서 추측이 됩니다.
- 병렬로 여러 에이전트를 실행하는 것은 서브태스크가 독립적인 경우 순차 호출보다 훨씬 빠릅니다. 단일 도구 호출 블록에서 일괄 처리하십시오.
- 에이전트가 파일을 작성할 것이고 메인 작업 트리에 병합하기 전에 변경 사항을 검토하려면 언제든 `isolation: "worktree"`를 사용하십시오.
- 읽기 전용 정찰에는 `subagent_type: "Explore"`를, 설계 작업에는 `Plan`을 선호하십시오. `general-purpose`는 혼합 읽기/쓰기 작업의 기본값입니다.
- 백그라운드 에이전트 (`run_in_background: true`)는 장시간 실행되는 작업에 적합합니다. sleep 루프로 폴링하지 마십시오 — 완료 시 부모에게 알림이 갑니다.
