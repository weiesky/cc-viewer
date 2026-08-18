# SuggestConnectors

`SearchMcpRegistry`가 반환한 `directoryUuid` 값의 전체 커넥터 페이로드를 확인하여, 사용자에게 활성화할 구체적인 커넥터를 제공할 수 있게 합니다.

## 사용 시점

- `SearchMcpRegistry`가 후보 커넥터를 반환한 후, 표시를 위해 전체 상세 정보를 가져옵니다.

## 활성화

- 퍼스트파티 API의 원격(claude.ai) 세션에서만 사용할 수 있습니다.

## 매개변수

- `uuids` (array of strings, 필수): 확인할 `directoryUuid` 또는 `server_id` 값. 1-32개 항목, 각각 1-64자.

## 예시

### 예시 1: 두 개의 레지스트리 히트 확인

```
SuggestConnectors(uuids=["d290f1ee-6c54-4b01-90e6-d701748f0851", "a1b2c3d4-0000-4000-8000-abcdefabcdef"])
```

## 참고사항

- UUID를 추측하지 마십시오 — `SearchMcpRegistry`에서 돌아온 식별자만 확인하십시오.
- 도구 자체는 아무것도 연결하지 않습니다. 커넥터 활성화는 별도로 이루어집니다.
