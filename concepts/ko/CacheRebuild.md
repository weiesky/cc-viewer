# Cache Rebuild（캐시 재구축）

## 배경

Anthropic의 prompt caching 메커니즘은 요청 내의 system → tools → messages（캐시 브레이크포인트까지）를 순서대로 연결하여 캐시 키를 생성합니다. 캐시 키가 이전 요청과 완전히 일치하면 API는 `cache_read_input_tokens`（캐시 히트）를 반환합니다. 캐시 키가 변경되면 API는 캐시를 다시 생성하고 대량의 `cache_creation_input_tokens`를 반환하는데, 이것이 캐시 재구축입니다.

캐시 재구축은 추가 토큰 과금을 의미합니다（cache creation 가격이 cache read보다 높음）. 따라서 재구축 원인을 식별하는 것은 비용 최적화에 직접적인 가치가 있습니다.

## 캐시 재구축 원인 분류

cc-viewer는 전후 두 MainAgent 요청의 body를 비교하여 캐시 재구축의 원인을 정확히 판정합니다:

| reason | 의미 | 판정 방법 |
|--------|------|-----------|
| `ttl` | 캐시 만료 | 이전 MainAgent 요청으로부터 5분 이상 경과 |
| `system_change` | system prompt 변경 | `JSON.stringify(prev.system) !== JSON.stringify(curr.system)` |
| `tools_change` | 도구 정의 변경 | `JSON.stringify(prev.tools) !== JSON.stringify(curr.tools)` |
| `model_change` | 모델 전환 | `prev.model !== curr.model` |
| `msg_truncated` | 메시지 스택 잘림 | 현재 요청의 messages 수가 이전보다 적음. 보통 컨텍스트 윈도우 오버플로우로 인한 잘림으로 발생 |
| `msg_modified` | 이력 메시지 수정 | 접두사 메시지 내용 불일치 (정상적인 추가 시 접두사는 완전히 동일해야 함) |
| `key_change` | 알 수 없는 키 변경 | 위 조건 모두 해당하지 않을 때의 폴백 |

## 판정 우선순위

1. 먼저 시간 간격 확인 — 5분 초과 시 바로 `ttl`로 판정하고 body 비교는 수행하지 않음
2. 이후 model, system, tools, messages를 순서대로 확인
3. 하나의 요청이 여러 원인에 동시에 해당할 수 있음 (예: 모델 전환 + system prompt 변경). 이 경우 `reasons` 배열에 모든 해당 항목이 포함되며, tooltip에서 줄바꿈으로 표시

## 일반적인 시나리오

- **`ttl`**: 사용자가 5분 이상 작업을 중단한 후 재개하여 캐시가 자연 만료
- **`system_change`**: Claude Code가 system prompt를 업데이트 (새 CLAUDE.md 로드, project instructions 변경 등)
- **`tools_change`**: MCP server 연결/해제로 사용 가능한 도구 목록 변경
- **`model_change`**: 사용자가 `/model` 명령으로 모델 전환
- **`msg_truncated`**: 대화가 길어져 컨텍스트 윈도우 관리가 작동, Claude Code가 초기 메시지를 잘라냄
- **`msg_modified`**: Claude Code가 이력 메시지를 편집 (예: `/compact`로 압축 요약이 원본 메시지를 대체)
