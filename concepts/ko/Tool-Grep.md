# Grep

## 정의

ripgrep 기반의 강력한 콘텐츠 검색 도구. 정규 표현식, 파일 타입 필터링, 다양한 출력 모드를 지원합니다.

## 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `pattern` | string | 예 | 정규 표현식 검색 패턴 |
| `path` | string | 아니오 | 검색 경로 (파일 또는 디렉토리), 기본값은 현재 작업 디렉토리 |
| `glob` | string | 아니오 | 파일명 필터 (예: `*.js`, `*.{ts,tsx}`) |
| `type` | string | 아니오 | 파일 타입 필터 (예: `js`, `py`, `rust`), glob보다 효율적 |
| `output_mode` | enum | 아니오 | 출력 모드: `files_with_matches` (기본값), `content`, `count` |
| `-i` | boolean | 아니오 | 대소문자 구분 없는 검색 |
| `-n` | boolean | 아니오 | 행 번호 표시 (content 모드만), 기본값 true |
| `-A` | number | 아니오 | 매치 후 표시할 행 수 |
| `-B` | number | 아니오 | 매치 전 표시할 행 수 |
| `-C` / `context` | number | 아니오 | 매치 전후 표시할 행 수 |
| `head_limit` | number | 아니오 | 출력 항목 수 제한, 기본값 0 (무제한) |
| `offset` | number | 아니오 | 처음 N개 결과 건너뛰기 |
| `multiline` | boolean | 아니오 | 다중 행 매칭 모드 활성화, 기본값 false |

## 사용 시나리오

**적합한 경우:**
- 코드베이스에서 특정 문자열이나 패턴 검색
- 함수/변수의 사용 위치 검색
- 파일 타입으로 검색 결과 필터링
- 매치 수 집계

**적합하지 않은 경우:**
- 파일명으로 파일 검색 — Glob를 사용해야 함
- 여러 라운드의 검색이 필요한 개방형 탐색 — Task (Explore 타입)를 사용해야 함

## 주의사항

- ripgrep 구문 사용 (grep이 아님), 중괄호 등 특수 문자는 이스케이프 필요
- `files_with_matches` 모드는 파일 경로만 반환하며 가장 효율적
- `content` 모드는 매칭 행 내용을 반환하며 컨텍스트 행 지원
- 다중 행 매칭은 `multiline: true` 설정 필요
- Bash 내의 `grep`이나 `rg` 명령보다 항상 Grep 도구를 우선 사용

## cc-viewer에서의 의의

Grep 호출은 요청 로그에서 `tool_use` / `tool_result` content block 쌍으로 나타납니다. `tool_result`에는 검색 결과가 포함됩니다.

## 원문

<textarea readonly>A powerful search tool built on ripgrep

  Usage:
  - ALWAYS use Grep for search tasks. NEVER invoke `grep` or `rg` as a Bash command. The Grep tool has been optimized for correct permissions and access.
  - Supports full regex syntax (e.g., "log.*Error", "function\s+\w+")
  - Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")
  - Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts
  - Use Agent tool for open-ended searches requiring multiple rounds
  - Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping (use `interface\{\}` to find `interface{}` in Go code)
  - Multiline matching: By default patterns match within single lines only. For cross-line patterns like `struct \{[\s\S]*?field`, use `multiline: true`
</textarea>
