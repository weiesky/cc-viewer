# getDiagnostics (mcp__ide__getDiagnostics)

## 정의

VS Code에서 언어 진단 정보를 가져옵니다. 구문 오류, 타입 오류, lint 경고 등을 포함합니다.

## 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `uri` | string | 아니오 | 파일 URI. 제공하지 않으면 모든 파일의 진단 정보를 가져옴 |

## 사용 시나리오

**적합한 경우:**
- 코드의 구문, 타입, lint 등 시맨틱 문제 확인
- 코드 편집 후 새로운 오류가 도입되지 않았는지 검증
- Bash 명령 대신 코드 품질 확인

**적합하지 않은 경우:**
- 테스트 실행 — Bash를 사용해야 함
- 런타임 오류 확인 — Bash로 코드를 실행해야 함

## 주의사항

- 이것은 MCP (Model Context Protocol) 도구이며, IDE 통합에 의해 제공
- VS Code / IDE 환경에서만 사용 가능
- 코드 문제 확인에는 Bash 명령보다 이 도구를 우선 사용

## cc-viewer에서의 의의

getDiagnostics는 MCP 도구이며, 요청 로그의 `tools` 배열에 `mcp__ide__getDiagnostics` 이름으로 나타납니다. 호출과 반환은 표준 `tool_use` / `tool_result` 패턴을 따릅니다. MCP 도구의 증감은 tools 배열 변화를 일으키며, 캐시 재구축을 트리거할 수 있습니다.

## 원문

<textarea readonly>Get language diagnostics from VS Code</textarea>
