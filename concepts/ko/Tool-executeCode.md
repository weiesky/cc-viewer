# executeCode (mcp__ide__executeCode)

## 정의

현재 notebook 파일의 Jupyter kernel에서 Python 코드를 실행합니다.

## 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `code` | string | 예 | 실행할 Python 코드 |

## 사용 시나리오

**적합한 경우:**
- Jupyter notebook 환경에서 코드 실행
- 코드 스니펫 테스트
- 데이터 분석 및 계산

**적합하지 않은 경우:**
- 비 Jupyter 환경에서의 코드 실행 — Bash를 사용해야 함
- 파일 수정 — Edit 또는 Write를 사용해야 함

## 주의사항

- 이것은 MCP (Model Context Protocol) 도구이며, IDE 통합에 의해 제공
- 코드는 현재 Jupyter kernel에서 실행되며, 상태는 호출 간에 유지
- 사용자가 명시적으로 요청하지 않는 한 변수 선언이나 kernel 상태 변경을 피해야 함
- kernel 재시작 후 상태가 소실됨

## cc-viewer에서의 의의

executeCode는 MCP 도구이며, 요청 로그의 `tools` 배열에 `mcp__ide__executeCode` 이름으로 나타납니다. 호출과 반환은 표준 `tool_use` / `tool_result` 패턴을 따릅니다. MCP 도구의 증감은 tools 배열 변화를 일으키며, 캐시 재구축을 트리거할 수 있습니다.

## 원문

<textarea readonly>Execute python code in the Jupyter kernel for the current notebook file.
    
    All code will be executed in the current Jupyter kernel.
    
    Avoid declaring variables or modifying the state of the kernel unless the user
    explicitly asks for it.
    
    Any code executed will persist across calls to this tool, unless the kernel
    has been restarted.</textarea>
