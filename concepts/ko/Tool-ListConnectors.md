# ListConnectors

사용자의 claude.ai 조직에 설치된 MCP 커넥터를 나열하며, 선택적으로 키워드로 필터링합니다.

## 사용 시점

- 새 커넥터를 제안하기 전에 이미 설치된 커넥터를 알아야 합니다.
- 사용자가 자신의 조직에 어떤 통합이 있는지 묻습니다.

## 매개변수

- `keywords` (array of strings, 선택): 목록 필터 — 최대 8개 항목, 각각 1-64자. 생략하면 전체를 나열합니다.

## 예시

### 예시 1: 설치된 모든 커넥터 나열

```
ListConnectors()
```

### 예시 2: 키워드로 필터링

```
ListConnectors(keywords=["github"])
```

## 참고사항

- 퍼스트파티 API의 원격(claude.ai) 세션에서만 사용할 수 있습니다.
- 전체 찾기-및-활성화 흐름을 위해 `SearchMcpRegistry`(발견)와 `SuggestConnectors`(상세 정보)를 함께 사용하십시오.
