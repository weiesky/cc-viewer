# Request Body 필드 설명

Claude API `/v1/messages` 요청 본문의 최상위 필드 설명.

## 필드 목록

| 필드 | 타입 | 설명 |
|------|------|------|
| **model** | string | 사용할 모델 이름. 예: `claude-opus-4-6`, `claude-sonnet-4-6` |
| **messages** | array | 대화 메시지 기록. 각 메시지에는 `role`(user/assistant)과 `content`(텍스트, 이미지, tool_use, tool_result 등의 block 배열)가 포함됨 |
| **system** | array | System prompt. Claude Code의 핵심 지시, 도구 사용 설명, 환경 정보, CLAUDE.md 내용 등을 포함. `cache_control`이 있는 블록은 prompt caching 됨 |
| **tools** | array | 사용 가능한 도구 정의 목록. 각 도구에는 `name`, `description`, `input_schema`(JSON Schema)가 포함됨. MainAgent는 보통 20개 이상의 도구를 가지며, SubAgent는 소수만 가짐 |
| **metadata** | object | 요청 메타데이터. 일반적으로 사용자를 식별하기 위한 `user_id`를 포함 |
| **max_tokens** | number | 모델이 단일 응답에서 생성할 수 있는 최대 토큰 수. 예: `16000`, `64000` |
| **thinking** | object | 확장 사고 설정. `type: "enabled"`로 사고 모드를 활성화하고, `budget_tokens`로 사고 토큰 상한을 제어 |
| **context_management** | object | 컨텍스트 관리 설정. `truncation: "auto"`를 사용하면 Claude Code가 너무 긴 메시지 기록을 자동으로 잘라냄 |
| **output_config** | object | 출력 설정. `format` 설정 등 |
| **stream** | boolean | 스트리밍 응답 활성화 여부. Claude Code는 항상 `true`를 사용 |

## messages 구조

각 메시지의 `content`는 block 배열이며, 일반적인 유형은 다음과 같음:

- **text**: 일반 텍스트 콘텐츠
- **tool_use**: 모델의 도구 호출 (`name`, `input` 포함)
- **tool_result**: 도구 실행 결과 (`tool_use_id`, `content` 포함)
- **image**: 이미지 콘텐츠 (base64 또는 URL)
- **thinking**: 모델의 사고 과정 (확장 사고 모드)

## system 구조

system prompt 배열에는 일반적으로 다음이 포함됨:

1. **핵심 agent 지시** ("You are Claude Code...")
2. **도구 사용 규범**
3. **CLAUDE.md 내용** (프로젝트 수준 지시)
4. **스킬 프롬프트** (skills reminder)
5. **환경 정보** (OS, shell, git 상태 등) — 사실 Claude Code는 git에 크게 의존함. 프로젝트에 git 저장소가 있으면 Claude Code는 원격 변경 사항과 커밋 기록을 가져와 분석을 보조하는 등 프로젝트에 대한 더 나은 이해 능력을 보여줌

`cache_control: { type: "ephemeral" }` 표시가 있는 블록은 Anthropic API에 의해 5분간 캐시되며, 캐시 적중 시 `cache_read_input_tokens`로 과금됨 (`input_tokens`보다 훨씬 저렴).

> **참고**: Claude Code와 같은 특수 클라이언트의 경우, Anthropic 서버 측은 실제로 요청의 `cache_control` 속성에 완전히 의존하여 캐싱 동작을 결정하지 않음. 서버 측은 특정 필드(system prompt, 도구 정의 등)에 대해 자동으로 캐싱 정책을 실행하며, 요청에 `cache_control` 표시가 명시적으로 포함되어 있지 않더라도 마찬가지임. 따라서 요청 본문에서 이 속성을 찾을 수 없더라도 의아하게 생각할 필요 없음 — 서버 측이 이미 백그라운드에서 캐싱 작업을 완료했으며, 단지 이 정보를 클라이언트에 노출하지 않았을 뿐임. 이는 Claude Code와 Anthropic API 사이의 일종의 암묵적 합의임.
