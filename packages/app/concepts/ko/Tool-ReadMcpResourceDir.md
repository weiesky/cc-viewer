# ReadMcpResourceDir

연결된 MCP 서버가 노출하는 디렉터리형 리소스의 항목을 URI로 지정하여 나열합니다.

## 사용 시점

- MCP 서버가 리소스를 계층적으로 구성하며 그 계층의 한 수준을 열거해야 합니다.
- `ReadMcpResource`로 개별 리소스를 읽기 전에 탐색하고 싶습니다.

## 활성화

- 항상 활성화되어 있지만 모델의 도구 목록에는 노출되지 않습니다 — 씬 클라이언트/사이드카 사용을 위한 것입니다.

## 매개변수

- `server` (string, 필수): MCP 서버 이름.
- `uri` (string, 필수): 나열할 디렉터리 리소스 URI.

## 예시

### 예시 1: 리소스 디렉터리 나열

```
ReadMcpResourceDir(server="filesystem", uri="file:///project/src/")
```

서버가 해당 디렉터리 URI 아래에서 노출하는 하위 항목을 반환합니다.

## 참고사항

- 리소스를 디렉터리로 모델링하는 서버만 이를 지원합니다. 평면적인 서버는 오류 또는 빈 목록을 반환합니다 — `ListMcpResources`로 폴백하십시오.
- `ReadMcpResource`와 결합하여 관련 있어 보이는 항목으로 파고드십시오.
