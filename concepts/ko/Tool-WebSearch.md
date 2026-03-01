# WebSearch

## 정의

검색 엔진 쿼리를 실행하여 최신 정보를 얻기 위한 검색 결과를 반환합니다.

## 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `query` | string | 예 | 검색 쿼리 (최소 2자) |
| `allowed_domains` | string[] | 아니오 | 이 도메인의 결과만 포함 |
| `blocked_domains` | string[] | 아니오 | 이 도메인의 결과를 제외 |

## 사용 시나리오

**적합한 경우:**
- 모델의 지식 컷오프 날짜를 넘는 최신 정보 획득
- 현재 이벤트 및 최신 데이터 검색
- 최신 기술 문서 검색

## 주의사항

- 검색 결과는 markdown 하이퍼링크 형식으로 반환
- 사용 후 응답 끝에 "Sources:" 섹션을 추가하고 관련 URL을 나열해야 함
- 도메인 필터링 (포함/제외) 지원
- 검색 쿼리에 현재 연도를 사용해야 함
- 미국에서만 사용 가능

## cc-viewer에서의 의의

WebSearch 호출은 요청 로그에서 `tool_use` / `tool_result` content block 쌍으로 나타납니다. `tool_result`에는 검색 결과 목록이 포함됩니다.

## 원문

<textarea readonly>
- Allows Claude to search the web and use the results to inform responses
- Provides up-to-date information for current events and recent data
- Returns search result information formatted as search result blocks, including links as markdown hyperlinks
- Use this tool for accessing information beyond Claude's knowledge cutoff
- Searches are performed automatically within a single API call

CRITICAL REQUIREMENT - You MUST follow this:
  - After answering the user's question, you MUST include a "Sources:" section at the end of your response
  - In the Sources section, list all relevant URLs from the search results as markdown hyperlinks: [Title](URL)
  - This is MANDATORY - never skip including sources in your response
  - Example format:

    [Your answer here]

    Sources:
    - [Source Title 1](https://example.com/1)
    - [Source Title 2](https://example.com/2)

Usage notes:
  - Domain filtering is supported to include or block specific websites
  - Web search is only available in the US

IMPORTANT - Use the correct year in search queries:
  - The current month is March 2026. You MUST use this year when searching for recent information, documentation, or current events.
  - Example: If the user asks for "latest React docs", search for "React documentation" with the current year, NOT last year
</textarea>
