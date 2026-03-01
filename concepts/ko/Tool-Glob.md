# Glob

## 정의

빠른 파일명 패턴 매칭 도구로, 모든 규모의 코드베이스를 지원합니다. 수정 시간순으로 정렬된 매칭 파일 경로를 반환합니다.

## 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `pattern` | string | 예 | glob 패턴 (예: `**/*.js`, `src/**/*.ts`) |
| `path` | string | 아니오 | 검색 디렉토리, 기본값은 현재 작업 디렉토리. "undefined"나 "null"을 전달하지 말 것 |

## 사용 시나리오

**적합한 경우:**
- 파일명 패턴으로 파일 검색
- 특정 타입의 모든 파일 검색 (예: 모든 `.tsx` 파일)
- 특정 클래스 정의 (예: `class Foo`)를 찾을 때 먼저 파일 위치 파악
- 단일 메시지 내에서 여러 Glob 호출을 병렬 실행 가능

**적합하지 않은 경우:**
- 파일 내용 검색 — Grep를 사용해야 함
- 여러 라운드의 검색이 필요한 개방형 탐색 — Task (Explore 타입)를 사용해야 함

## 주의사항

- 표준 glob 구문 지원: `*`는 단일 레벨, `**`는 다중 레벨, `{}`는 다중 선택 매칭
- 결과는 수정 시간순으로 정렬
- Bash의 `find` 명령보다 권장

## cc-viewer에서의 의의

Glob 호출은 요청 로그에서 `tool_use` / `tool_result` content block 쌍으로 나타납니다. `tool_result`에는 매칭된 파일 경로 목록이 포함됩니다.

## 원문

<textarea readonly>- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead
- You can call multiple tools in a single response. It is always better to speculatively perform multiple searches in parallel if they are potentially useful.</textarea>
