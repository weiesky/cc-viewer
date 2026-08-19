# 번역 API 컨텍스트 오염

## 배경

CC-Viewer에는 Anthropic Messages API를 활용한 내장 번역 기능(`POST /api/translate`)이 포함되어 있습니다. 초기 구현에서는 번역 요청이 Claude Code 세션에서 캐시된 인증 자격 증명(`x-api-key`와 `authorization` 헤더 모두)을 재사용했습니다. 이로 인해 미묘하지만 심각한 문제가 발생했습니다: 번역 결과에 관련 없는 콘텐츠가 빈번하게 반환되었습니다.

## 근본 원인

### 두 가지 인증 방식의 본질적 차이

Anthropic API는 두 가지 인증 방식을 지원합니다:

| 방식 | 헤더 | 일반적인 출처 | 특징 |
|------|------|---------------|------|
| API 키 | `x-api-key: sk-ant-...` | 환경 변수 / Console | 무상태, 각 요청이 독립적 |
| OAuth 토큰 | `authorization: Bearer sessionToken` | Claude Code 구독 로그인 | 세션에 바인딩, 서버가 컨텍스트 연관을 유지 |

핵심 차이점: **API 키는 무상태(stateless)**로 각 요청이 완전히 독립적입니다. 반면 **OAuth 세션 토큰은 상태 유지(stateful)**로, Anthropic 서버가 동일한 토큰을 사용하는 요청을 같은 세션 컨텍스트에 연관시킵니다.

### 오염 체인

Claude Code가 구독형 OAuth 로그인을 사용할 때 인증 흐름은 다음과 같습니다:

```
Claude Code 메인 대화 ──(authorization: Bearer sessionToken)──→ Anthropic API
                                                                    ↑
CC-Viewer 번역 요청 ──(authorization: Bearer sessionToken)──→ Anthropic API
```

번역 요청이 동일한 세션 토큰을 재사용했기 때문에, Anthropic 서버가 번역 요청을 Claude Code의 메인 대화 컨텍스트에 연관시킬 수 있었습니다. 이로 인해 다음과 같은 문제가 발생합니다:

1. **번역 결과가 메인 대화 컨텍스트의 영향을 받음**: 번역 요청의 시스템 프롬프트는 "당신은 번역가입니다"이지만, 서버 컨텍스트에는 여전히 Claude Code의 대화 기록이 포함되어 있어 모델에 간섭할 수 있습니다
2. **메인 대화가 번역 요청에 의해 교란됨**: 번역 요청 내용(UI 텍스트 조각)이 메인 대화 컨텍스트에 주입되어 Claude Code의 응답이 벗어날 수 있습니다
3. **예측 불가능한 동작**: 컨텍스트 오염은 서버 측 동작이므로 클라이언트에서 감지하거나 제어할 수 없습니다

## 교훈

- **OAuth 세션 토큰은 "단순한 또 다른 API 키"가 아닙니다** — 서버 측 상태를 가지고 있으며, 재사용은 컨텍스트 공유를 의미합니다
- **내부 서비스 호출은 독립적이고 무상태인 인증을 사용해야** 하며, 사용자 세션과의 연관을 피해야 합니다

## 참고 자료

- [Anthropic API Authentication Docs](https://docs.anthropic.com/en/api/getting-started)
- [Claude Code Authentication](https://support.claude.com/en/articles/12304248-managing-api-key-environment-variables-in-claude-code)
- [Anthropic Bans Subscription OAuth in Third-Party Apps](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/)
- [Claude Code Authentication: API Keys, Subscriptions, and SSO](https://developertoolkit.ai/en/claude-code/quick-start/authentication/)
