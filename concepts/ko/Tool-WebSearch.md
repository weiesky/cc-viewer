# WebSearch

실시간 웹 검색을 수행하고 순위가 매겨진 결과를 반환합니다. 어시스턴트는 이를 사용하여 모델의 학습 컷오프를 넘어 현재 정보로 답변을 뒷받침합니다.

## 사용 시점

- 시사, 최근 릴리스, 또는 속보에 대한 질문 답변.
- 라이브러리, 프레임워크, 또는 CLI 도구의 최신 버전 조회.
- 정확한 URL을 모를 때 문서나 블로그 게시물 찾기.
- 모델이 훈련된 이후 변경되었을 수 있는 사실 확인.
- `WebFetch`로 단일 페이지를 가져오기 전에 주제에 대한 여러 관점 발견.

## 활성화

- 사용 가능 여부는 제공자와 모델에 따라 다릅니다: Anthropic API와 AWS의 Claude Platform에서 사용할 수 있습니다. Microsoft Foundry에서는 Anthropic 호스팅 배포가 필요하며, Google Cloud에서는 Claude 4+ 모델과 함께 작동합니다.
- Amazon Bedrock에서는 사용할 수 없습니다.
- `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION`으로 세션당 호출 횟수를 200회로 제한합니다.

## 매개변수

- `query` (string, 필수): 검색 쿼리. 최소 길이 2자. "최신" 또는 "최근" 정보에 대해 질문할 때 결과가 신선하도록 현재 연도를 포함하십시오.
- `allowed_domains` (array of strings, 선택): 결과를 이러한 도메인으로만 제한합니다. 예를 들어 `["nodejs.org", "developer.mozilla.org"]`. 특정 소스를 신뢰할 때 유용합니다.
- `blocked_domains` (array of strings, 선택): 이러한 도메인의 결과를 제외합니다. 동일한 도메인을 `allowed_domains`와 `blocked_domains` 모두에 전달하지 마십시오.

## 예시

### 예시 1: 현재 연도로 버전 조회

```
WebSearch(
  query="React 19 stable release date 2026",
  allowed_domains=["react.dev", "github.com"]
)
```

공식 발표를 반환하며 저품질 집계자 사이트를 피합니다.

### 예시 2: 노이즈가 많은 소스 제외

```
WebSearch(
  query="kubernetes ingress-nginx CVE April 2026",
  blocked_domains=["pinterest.com", "medium.com"]
)
```

결과를 벤더 권고 및 보안 추적기에 집중시킵니다.

## 참고사항

- 답변에서 `WebSearch`를 사용할 때 `[Title](URL)` 형식의 Markdown 하이퍼링크로 각 인용 결과를 나열하는 `Sources:` 섹션을 응답 끝에 추가해야 합니다. 이것은 선택 사항이 아닌 필수 요구사항입니다.
- `WebSearch`는 미국 내 사용자에게만 제공됩니다. 지역에서 도구를 사용할 수 없는 경우 알려진 URL에 대해 `WebFetch`로 대체하거나 사용자에게 관련 콘텐츠를 붙여 넣도록 요청하십시오.
- 각 호출은 단일 왕복으로 검색을 수행합니다 — 스트리밍하거나 페이지를 매길 수 없습니다. 첫 번째 결과 세트가 빗나가면 쿼리를 수정하십시오.
- 도구는 전체 페이지 내용이 아닌 스니펫과 메타데이터를 반환합니다. 특정 히트를 깊이 읽으려면 반환된 URL로 `WebFetch`를 후속으로 사용하십시오.
- CVE나 규정 준수와 같은 보안에 민감한 질문에 대해 권위 있는 소싱을 적용하려면 `allowed_domains`를 사용하고, 문서를 미러링하는 SEO 팜을 제거하려면 `blocked_domains`를 사용하십시오.
- 쿼리를 짧고 키워드 중심으로 유지하십시오. 자연어 질문도 작동하지만 일차 소스가 아닌 대화형 답변을 반환하는 경향이 있습니다.
- 검색 직관에 기반하여 URL을 발명하지 마십시오 — 항상 검색을 실행하고 도구가 실제로 반환한 것을 인용하십시오.
