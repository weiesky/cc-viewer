# WebFetch

## 정의

지정된 URL의 웹페이지 내용을 가져와 HTML을 markdown으로 변환하고, AI 모델로 prompt에 따라 내용을 처리합니다.

## 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `url` | string (URI) | 예 | 가져올 완전한 URL |
| `prompt` | string | 예 | 페이지에서 어떤 정보를 추출할지 설명 |

## 사용 시나리오

**적합한 경우:**
- 공개 웹페이지의 내용 가져오기
- 온라인 문서 참조
- 웹페이지에서 특정 정보 추출

**적합하지 않은 경우:**
- 인증이 필요한 URL (Google Docs, Confluence, Jira, GitHub 등) — 먼저 전용 MCP 도구를 찾아야 함
- GitHub URL — `gh` CLI를 우선 사용

## 주의사항

- URL은 완전한 유효 URL이어야 함
- HTTP는 자동으로 HTTPS로 업그레이드
- 내용이 너무 크면 결과가 요약될 수 있음
- 15분 자동 정리 캐시 포함
- URL이 다른 호스트로 리다이렉트되면 도구가 리다이렉트 URL을 반환하며, 새 URL로 재요청 필요
- MCP 제공 web fetch 도구가 사용 가능하면 그것을 우선 사용

## cc-viewer에서의 의의

WebFetch 호출은 요청 로그에서 `tool_use` / `tool_result` content block 쌍으로 나타납니다. `tool_result`에는 AI 처리 후의 웹페이지 내용 요약이 포함됩니다.

## 원문

<textarea readonly>IMPORTANT: WebFetch WILL FAIL for authenticated or private URLs. Before using this tool, check if the URL points to an authenticated service (e.g. Google Docs, Confluence, Jira, GitHub). If so, you MUST use ToolSearch first to find a specialized tool that provides authenticated access.

- Fetches content from a specified URL and processes it using an AI model
- Takes a URL and a prompt as input
- Fetches the URL content, converts HTML to markdown
- Processes the content with the prompt using a small, fast model
- Returns the model's response about the content
- Use this tool when you need to retrieve and analyze web content

Usage notes:
  - IMPORTANT: If an MCP-provided web fetch tool is available, prefer using that tool instead of this one, as it may have fewer restrictions.
  - The URL must be a fully-formed valid URL
  - HTTP URLs will be automatically upgraded to HTTPS
  - The prompt should describe what information you want to extract from the page
  - This tool is read-only and does not modify any files
  - Results may be summarized if the content is very large
  - Includes a self-cleaning 15-minute cache for faster responses when repeatedly accessing the same URL
  - When a URL redirects to a different host, the tool will inform you and provide the redirect URL in a special format. You should then make a new WebFetch request with the redirect URL to fetch the content.
  - For GitHub URLs, prefer using the gh CLI via Bash instead (e.g., gh pr view, gh issue view, gh api).
</textarea>
