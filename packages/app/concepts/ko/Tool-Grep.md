# Grep

ripgrep 엔진을 사용하여 파일 내용을 검색합니다. 완전한 정규 표현식 지원, 파일 타입 필터링, 세 가지 출력 모드를 제공하여 정밀도와 간결성을 트레이드할 수 있습니다.

## 사용 시점

- 함수의 모든 호출 사이트나 식별자에 대한 모든 참조 찾기
- 문자열이나 오류 메시지가 코드베이스 어디에든 나타나는지 확인
- 리팩터링 전에 영향을 측정하기 위해 패턴의 발생 횟수 계산
- 파일 타입 (`type: "ts"`) 또는 글로브 (`glob: "**/*.tsx"`)로 검색 좁히기
- `multiline: true`로 여러 줄의 구조체 정의나 JSX 블록과 같은 교차 줄 매치 가져오기

## 매개변수

- `pattern` (string, 필수): 검색할 정규 표현식. ripgrep 문법을 사용하므로 리터럴 중괄호는 이스케이프가 필요합니다 (예: `interface{}`를 찾으려면 `interface\{\}`).
- `path` (string, 선택): 검색할 파일 또는 디렉토리. 기본값은 현재 작업 디렉토리입니다.
- `glob` (string, 선택): `*.js` 또는 `*.{ts,tsx}`와 같은 파일 이름 필터.
- `type` (string, 선택): `js`, `py`, `rust`, `go`와 같은 파일 타입 단축키. 표준 언어의 경우 `glob`보다 효율적입니다.
- `output_mode` (enum, 선택): `files_with_matches` (기본값, 경로만 반환), `content` (매칭 줄 반환), 또는 `count` (매치 횟수 반환).
- `-i` (boolean, 선택): 대소문자 구분 없는 매칭.
- `-n` (boolean, 선택): `content` 모드에서 줄 번호 포함. 기본값은 `true`입니다.
- `-A` (number, 선택): 각 매치 뒤에 표시할 컨텍스트 줄 수 (`content` 모드 필요).
- `-B` (number, 선택): 각 매치 앞의 컨텍스트 줄 수 (`content` 모드 필요).
- `-C` / `context` (number, 선택): 각 매치 양쪽의 컨텍스트 줄 수.
- `multiline` (boolean, 선택): 패턴이 줄바꿈을 걸칠 수 있도록 허용합니다 (`.`이 `\n`과 매치). 기본값은 `false`입니다.
- `head_limit` (number, 선택): 반환되는 줄, 파일 경로, 또는 카운트 항목을 제한합니다. 기본값은 250. 무제한은 `0`을 전달하십시오 (신중하게 사용).
- `offset` (number, 선택): `head_limit`을 적용하기 전에 처음 N개 결과를 건너뜁니다. 기본값은 `0`입니다.

## 예시

### 예시 1: 함수의 모든 호출 사이트 찾기
각 호출의 주변 줄을 보려면 `pattern: "registerHandler\\("`, `output_mode: "content"`, `-C: 2`를 설정합니다.

### 예시 2: 타입 전체의 매치 수 계산
Python 소스에서 파일별 TODO 합계를 보려면 `pattern: "TODO"`, `type: "py"`, `output_mode: "count"`를 설정합니다.

### 예시 3: 다중 라인 구조체 매치
Go 구조체의 여러 줄에 선언된 필드를 캡처하려면 `pattern: "struct Config \\{[\\s\\S]*?version"`과 `multiline: true`를 사용합니다.

## 참고사항

- `Bash`를 통해 `grep`이나 `rg`를 실행하는 것보다 항상 `Grep`을 선호하십시오. 이 도구는 올바른 권한과 구조화된 출력에 최적화되어 있습니다.
- 기본 출력 모드는 `files_with_matches`로 가장 저렴합니다. 라인 자체를 봐야 할 때만 `content`로 전환하십시오.
- 컨텍스트 플래그 (`-A`, `-B`, `-C`)는 `output_mode`가 `content`가 아니면 무시됩니다.
- 큰 결과 세트는 컨텍스트 토큰을 소모합니다. 초점을 유지하려면 `head_limit`, `offset`, 또는 더 엄격한 `glob`/`type` 필터를 사용하십시오.
- 파일 이름 발견의 경우 대신 `Glob`을 사용하십시오. 여러 라운드에 걸친 개방형 조사의 경우 Explore 에이전트로 `Agent`를 디스패치하십시오.
