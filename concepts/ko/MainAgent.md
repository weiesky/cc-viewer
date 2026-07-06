# MainAgent

## 정의

MainAgent는 Claude Code가 비 agent team 상태에서의 주간 요청 체인입니다. 사용자와 Claude Code의 상호작용마다 일련의 API 요청이 생성되며, 그 중 MainAgent 요청이 핵심 대화 체인을 구성합니다. 이들은 완전한 system prompt, 도구 정의, 메시지 이력을 포함합니다.

## 식별 방법

cc-viewer에서 MainAgent는 `req.mainAgent === true`로 식별되며, `interceptor.js`가 요청 캡처 시 자동으로 마킹합니다.

판정 조건 (모두 충족):
- 요청 본문에 `system` 필드 (system prompt) 포함
- 요청 본문에 `tools` 배열 (도구 정의) 포함
- system prompt에 "Claude Code" 특징 텍스트 포함

## SubAgent와의 차이

| 특징 | MainAgent | SubAgent |
|------|-----------|----------|
| system prompt | 완전한 Claude Code 메인 프롬프트 | 간결한 태스크 전용 프롬프트 |
| tools 배열 | 사용 가능한 모든 도구 포함 | 보통 태스크에 필요한 소수의 도구만 포함 |
| 메시지 이력 | 완전한 대화 컨텍스트 축적 | 서브태스크 관련 메시지만 포함 |
| 캐시 동작 | prompt caching 있음 (5분 TTL) | 보통 캐시 없음 또는 캐시가 작음 |
