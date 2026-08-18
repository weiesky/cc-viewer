# LSP

Language Server Protocol (LSP) 서버에 질의하여 코드 인텔리전스 — 정의, 참조, 호버, 심볼, 구현, 호출 계층 — 를 가져옵니다. 코드를 의미적으로 이해하므로 텍스트 검색보다 정확합니다.

## 사용 시점

- 심볼의 정의로 이동하거나 (`goToDefinition`) 모든 참조를 찾기 (`findReferences`)
- 심볼의 타입 시그니처 / 문서 읽기 (`hover`)
- 한 파일의 심볼을 나열하거나 (`documentSymbol`) 프로젝트 전체에서 검색하기 (`workspaceSymbol`)
- 인터페이스나 추상 메서드의 구현 찾기 (`goToImplementation`)
- 함수의 호출 계층 따라가기 (`prepareCallHierarchy`, `incomingCalls`, `outgoingCalls`)

## 활성화

- 해당 언어의 코드 인텔리전스 플러그인이 설치되기 전까지는 비활성 상태입니다(서버 바이너리는 별도로 설치됩니다).
- 이 도구는 LSP 클라이언트가 연결된 경우에만 나타납니다.

## 매개변수

- `operation` (string, 필수): 위에 나열된 작업 중 하나.
- `filePath` (string, 필수): 작업할 파일.
- `line` (number, 필수): 에디터에 표시되는 1부터 시작하는 줄 번호.
- `character` (number, 필수): 에디터에 표시되는 1부터 시작하는 문자 오프셋.

## 참고사항

- 해당 파일 타입에 맞게 구성된 LSP 서버가 필요합니다. 그렇지 않으면 호출이 오류를 반환합니다.
- line과 character는 0부터가 아니라 1부터 시작합니다 (에디터 좌표).
- 텍스트 일치가 아니라 의미적 탐색 (실제 정의/참조)이 필요할 때는 `Grep`보다 LSP를 선호하십시오.

## 관련 개념

- 코드를 탐색하고 변경할 때 `Read`와 `Edit`를 보완합니다.
