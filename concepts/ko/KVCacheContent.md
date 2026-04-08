# KV-Cache 캐시 내용

## Prompt Caching이란?

Claude와 대화할 때, 매 API 요청마다 완전한 대화 컨텍스트(system prompt + 도구 정의 + 과거 메시지)가 전송됩니다. Anthropic의 prompt caching 메커니즘은 이미 계산된 접두사 내용을 서버 측에 캐시하고, 후속 요청에서 접두사가 일치하면 캐시 결과를 직접 재사용하여 중복 계산을 건너뛰고, 지연 시간과 비용을 대폭 줄입니다.

cc-viewer에서는 이 메커니즘을 "KV-Cache"라고 부르지만, 이는 Anthropic API 수준의 prompt caching에 해당하는 것이며, LLM 내부 transformer 어텐션 레이어의 key-value cache가 아닙니다.

## 캐시의 작동 원리

Anthropic의 prompt caching은 고정된 순서로 캐시 키를 연결합니다:

```
Tools → System Prompt → Messages(캐시 브레이크포인트까지)
```

이 접두사가 TTL 윈도우 내의 어떤 요청과 완전히 일치하면, API는 캐시에 히트(`cache_read_input_tokens` 반환)하며 재계산(`cache_creation_input_tokens`)을 수행하지 않습니다.

> **Claude Code는 `cache_control` 속성에 강하게 의존하지 않으며, 서버 측에서 이러한 속성의 일부를 제거하면서도 캐시를 잘 생성할 수 있으므로, `cache_control` 속성이 보이지 않는다고 해서 캐시되지 않은 것은 아닙니다**
>
> Claude Code와 같은 특수 클라이언트에 대해, Anthropic 서버 측은 요청 내 `cache_control` 속성에만 완전히 의존하여 캐시 동작을 결정하지 않습니다. 서버 측은 특정 필드(system prompt, tools 정의 등)에 대해 자동으로 캐시 정책을 실행하며, 요청에 `cache_control` 표시가 명시적으로 포함되어 있지 않아도 마찬가지입니다. 따라서 요청 본문에서 이 속성이 보이지 않아도 의아해할 필요가 없습니다 -- 서버 측에서 이미 백그라운드에서 캐시 작업을 완료했지만, 이 정보를 클라이언트에 노출하지 않았을 뿐입니다. 이는 Claude Code와 Anthropic API 사이의 암묵적 합의입니다.

## "현재 KV-Cache 캐시 내용"이란?

cc-viewer에 표시되는 "현재 KV-Cache 캐시 내용"은 최근 MainAgent 요청에서 추출된, 캐시 경계(cache breakpoint) 이전의 내용입니다. 구체적으로 다음을 포함합니다:

- **System Prompt**: Claude Code의 시스템 지시사항으로, 핵심 agent 지시, 도구 사용 규범, CLAUDE.md 프로젝트 지시, 환경 정보 등을 포함
- **Tools**: 현재 사용 가능한 도구 정의 목록(Read, Write, Bash, Agent, MCP 도구 등)
- **Messages**: 대화 이력에서 캐시된 부분(일반적으로 초기 메시지로, 마지막 `cache_control` 표시까지)

## 캐시 내용을 확인하는 이유

1. **컨텍스트 이해**: Claude가 현재 "기억하고 있는" 내용을 파악하여, 그 동작이 예상대로인지 판단하는 데 도움
2. **비용 최적화**: 캐시 히트 시 비용은 재계산보다 훨씬 낮음. 캐시 내용을 확인하면 특정 요청이 캐시 재구축(cache rebuild)을 트리거한 이유를 이해할 수 있음
3. **대화 디버깅**: Claude의 답변이 예상과 다를 때, 캐시 내용을 확인하여 system prompt와 과거 메시지가 올바른지 확인 가능
4. **컨텍스트 품질 모니터링**: 디버깅, 설정 변경, prompt 조정 과정에서 KV-Cache-Text는 집중된 시각을 제공하여, 핵심 컨텍스트가 저하되지 않았는지, 예상치 못한 내용으로 오염되지 않았는지 빠르게 확인할 수 있음 -- 원본 메시지를 하나씩 검토할 필요 없음

## 다중 레벨 캐시 전략

Claude Code에 대응하는 KV-Cache는 하나만 있는 것이 아닙니다. 서버 측에서는 Tools와 System Prompt에 대해 각각 별도의 캐시를 생성하며, Messages 부분의 캐시와는 독립적입니다. 이렇게 설계하면 messages 스택에 혼란이 발생했을 때(컨텍스트 잘림, 메시지 수정 등) 재구축이 필요하더라도, Tools와 System Prompt의 캐시가 함께 무효화되지 않아 전체 재계산을 방지할 수 있습니다.

이것은 현 단계 서버 측의 최적화 전략입니다 -- Tools 정의와 System Prompt는 정상적인 사용 과정에서 비교적 안정적이고 변경이 적으므로, 별도로 캐시하면 불필요한 재구축 비용을 최대한 줄일 수 있습니다. 따라서 Cache를 관찰하면, Tools 재구축은 모든 캐시를 완전히 새로고침해야 하지만, System Prompt와 Messages의 파손은 여전히 계승할 수 있는 캐시가 남아 있다는 것을 발견할 수 있습니다.

## 캐시의 생명주기

- **생성**: 초기 요청 또는 캐시 무효화 후 API는 새 캐시를 생성(`cache_creation_input_tokens`)
- **히트**: 후속 요청의 접두사가 일치하면 캐시 재사용(`cache_read_input_tokens`)
- **만료**: 캐시는 5분의 TTL(존속 시간)을 가지며, 타임아웃 후 자동 무효화
- **재구축**: system prompt, 도구 목록, 모델 또는 메시지 내용이 변경되면 캐시 키가 일치하지 않아 해당 레벨의 캐시 재구축이 트리거됨
