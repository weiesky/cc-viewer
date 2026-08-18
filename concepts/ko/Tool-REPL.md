# REPL

세션 내부의 영속적인 Node.js vm 컨텍스트에서 JavaScript를 실행합니다. 최상위 `await`가 지원되며, 한 호출에서 정의된 변수/함수는 이후 호출에서도 계속 사용할 수 있습니다.

## 사용 시점

- 셸 원라이너보다 코드로 작성하는 편이 쉬운 빠른 계산, 데이터 변환, 또는 JSON 다루기.
- 호출 사이에 중간 상태(카운터, 누적 결과)가 유지되어야 하는 다단계 스크립팅.
- 파일에 작성하기 전에 API나 라이브러리 동작을 대화형으로 탐색.

## 매개변수

- `code` (string, 필수): 실행할 JavaScript 코드. 최상위 await를 지원합니다. 상태는 호출 간에 유지됩니다.
- `description` (string, 선택): 이 스크립트가 무엇을 하는지 능동태로 작성한 명확하고 간결한 설명 (5-10단어), 예: "Trace upgrade message to its GrowthBook flag".
- `timeout` (number, 선택): 밀리초 단위 타임아웃. 기본값 30000, 최대 600000.

## 예시

### 예시 1: 계산하고 상태 재사용

```
REPL(code="const counts = new Map(); ['a','b','a'].forEach(k => counts.set(k, (counts.get(k)||0)+1)); counts.get('a')")
```

`2`를 반환합니다. `counts`는 같은 세션의 후속 REPL 호출에서 정의된 상태로 유지됩니다.

### 예시 2: 더 긴 타임아웃과 함께 최상위 await

```
REPL(
  code="const res = await fetch('https://example.com/api'); await res.json()",
  description="Fetch example API and parse JSON",
  timeout=60000
)
```

## 참고사항

- 상태는 세션 단위입니다: 세션을 재시작하면 모든 정의가 지워집니다.
- 이것은 JavaScript(Node) 환경입니다 — 셸 명령, 파일시스템 중심 작업, 또는 비-JS 런타임에는 Bash를 사용하십시오.
- 장시간 실행되는 코드는 명시적인 `timeout`을 설정해야 합니다. 기본 30초는 그보다 느린 모든 것을 종료시킵니다.
