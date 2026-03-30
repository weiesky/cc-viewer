# Response Body 필드 설명

Claude API `/v1/messages` 응답 본문의 필드 설명.

## 최상위 필드

| 필드 | 타입 | 설명 |
|------|------|------|
| **model** | string | 실제 사용된 모델 이름. 예: `claude-opus-4-6` |
| **id** | string | 이번 응답의 고유 식별자. 예: `msg_01Tgsr2QeH8AVXGoP2wAXRvU` |
| **type** | string | 고정값 `"message"` |
| **role** | string | 고정값 `"assistant"` |
| **content** | array | 모델 출력의 콘텐츠 블록 배열. 텍스트, 도구 호출, 사고 과정 등을 포함 |
| **stop_reason** | string | 중지 사유: `"end_turn"`(정상 종료), `"tool_use"`(도구 실행 필요), `"max_tokens"`(토큰 상한 도달) |
| **stop_sequence** | string/null | 중지를 트리거한 시퀀스. 일반적으로 `null` |
| **usage** | object | 토큰 사용량 통계 (자세한 내용은 아래 참조) |

## content 블록 유형

| 유형 | 설명 |
|------|------|
| **text** | 모델의 텍스트 응답. `text` 필드를 포함 |
| **tool_use** | 도구 호출 요청. `name`(도구 이름), `input`(매개변수), `id`(호출 ID, tool_result 매칭에 사용)를 포함 |
| **thinking** | 확장 사고 내용 (thinking 모드가 활성화된 경우에만 나타남). `thinking` 필드를 포함 |

## usage 필드 상세

| 필드 | 설명 |
|------|------|
| **input_tokens** | 캐시에 적중하지 않은 입력 토큰 수 (정가로 과금) |
| **cache_creation_input_tokens** | 이번에 새로 생성된 캐시의 토큰 수 (캐시 쓰기, 일반 입력보다 높은 요금) |
| **cache_read_input_tokens** | 캐시에 적중한 토큰 수 (캐시 읽기, 일반 입력보다 훨씬 낮은 요금) |
| **output_tokens** | 모델 출력 토큰 수 |
| **service_tier** | 서비스 등급. 예: `"standard"` |
| **inference_geo** | 추론 지역. 예: `"not_available"`은 지역 정보가 제공되지 않음을 의미 |

## cache_creation 하위 필드

| 필드 | 설명 |
|------|------|
| **ephemeral_5m_input_tokens** | TTL 5분의 단기 캐시 생성 토큰 수 |
| **ephemeral_1h_input_tokens** | TTL 1시간의 장기 캐시 생성 토큰 수 |

> **캐시 과금에 대하여**: `cache_read_input_tokens`의 단가는 `input_tokens`보다 훨씬 낮고, `cache_creation_input_tokens`의 단가는 일반 입력보다 약간 높습니다. 따라서 지속적인 대화에서 높은 캐시 적중률을 유지하면 비용을 크게 절감할 수 있습니다. cc-viewer의 "적중률" 지표를 통해 이 비율을 직관적으로 모니터링할 수 있습니다.

## stop_reason 의미

- **end_turn**: 모델이 정상적으로 응답을 완료
- **tool_use**: 모델이 도구 호출이 필요하며, content에 `tool_use` 블록이 포함됨. 다음 요청에서는 messages에 `tool_result`를 추가해야 대화를 계속할 수 있음
- **max_tokens**: `max_tokens` 제한에 도달하여 잘림. 응답이 불완전할 수 있음
