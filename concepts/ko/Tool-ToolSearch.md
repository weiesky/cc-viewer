# ToolSearch

"지연 로드 도구"의 전체 스키마 정의를 필요할 때 가져와 호출 가능하게 만듭니다. 많은 도구가 사용 가능한 경우 일부는 미리 로드되지 않고 `<system-reminder>` 메시지 안에 이름만 나타납니다. 스키마를 가져오기 전까지는 이름만 알 수 있고 매개변수 정의가 없으므로 해당 도구를 호출할 수 없습니다. `ToolSearch`는 쿼리를 받아 지연 로드 도구 목록과 대조하고, 일치하는 도구의 전체 JSONSchema 정의를 `<functions>` 블록 안에 반환합니다. 도구의 스키마가 결과에 나타나면 프롬프트 상단에 정의된 도구와 똑같이 호출 가능해집니다.

## 사용 시점

- 지연 로드 도구가 필요한 경우 — 그 이름이 `<system-reminder>`에 나타나지만 최상위 도구 목록에는 매개변수 정의가 없습니다.
- 필요할 때 로드되는 MCP 서버의 도구(예: Slack, Gmail, computer-use)를 사용하려는 경우.
- 어떤 기능에 대한 정확한 도구 이름을 확신하지 못해 키워드로 후보를 한 번에 드러내고 싶은 경우.

도구의 스키마가 이미 컨텍스트에 있다면 다시 검색하지 마십시오 — 그냥 호출하십시오.

## 활성화

- 기본적으로 켜져 있습니다.
- `ANTHROPIC_BASE_URL`이 Anthropic이 아닌 엔드포인트를 가리키는 경우(`ENABLE_TOOL_SEARCH`가 설정된 경우 제외), `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`가 설정된 경우, 모델이 도구 참조를 지원하지 않는 경우(Claude 4.5 이전 Vertex AI 모델), 또는 `"deny": ["ToolSearch"]`로 거부된 경우 꺼집니다.

## 매개변수

- `query` (string, 필수): 지연 로드 도구를 찾는 데 사용하는 쿼리. 세 가지 형식이 지원됩니다:
  - `select:Read,Edit,Grep` — 이 정확한 이름으로 도구를 가져옵니다.
  - `notebook jupyter` — 키워드 검색으로, 최대 `max_results`개의 가장 적합한 일치 항목을 반환합니다.
  - `+slack send` — 도구 이름에 `slack`이 나타나도록 요구한 다음 나머지 용어로 순위를 매깁니다.
- `max_results` (number, 선택): 반환할 결과의 최대 개수. 기본값은 5입니다.

## 예시

### 예시 1: 정확한 이름으로 가져오기

```
ToolSearch(query="select:WebFetch,WebSearch", max_results=5)
```

### 예시 2: 키워드 검색

```
ToolSearch(query="notebook jupyter", max_results=5)
```

### 예시 3: MCP 툴킷 전체를 한 번에 로드

MCP 서버의 모든 도구(예: computer-use)를 일괄 로드할 때는 각각을 선택하는 대신 단일 키워드 검색을 사용하십시오 — 서버 이름은 부분 문자열로서 해당 서버 아래의 모든 도구에 일치합니다:

```
ToolSearch(query="computer-use", max_results=30)
```

## 참고사항

- 지연 로드 도구를 호출하기 전에 먼저 `ToolSearch`로 그 스키마를 가져와야 합니다 — 매개변수 정의가 없으므로 직접 호출하면 실패합니다.
- 툴킷 전체(예: MCP 서버의 모든 도구)를 일괄 로드할 때는 왕복 횟수를 줄이기 위해 여러 번의 `select:` 호출보다 한 번의 키워드 검색을 선호하십시오.
- 스키마를 가져오면 도구는 일반 도구와 똑같이 동작합니다. 같은 도구를 다시 검색하지 마십시오.
- 결과는 `<functions>` 블록으로 돌아오며, 각 도구는 하나의 `<function>{...}</function>` 줄입니다 — 최상위 도구 목록과 동일한 인코딩입니다.
