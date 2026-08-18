# ReadMcpResource

연결된 MCP(Model Context Protocol) 서버가 노출하는 단일 리소스를 URI로 지정하여 읽습니다.

## 사용 시점

- MCP 서버가 컨텍스트에 필요한 콘텐츠를 가진 리소스(파일, 레코드, 문서)를 광고합니다.
- `ListMcpResources`, 서버 문서, 또는 이전 도구 결과에서 구체적인 리소스 URI를 알고 있습니다.

## 매개변수

- `server` (string, 필수): MCP 서버 이름.
- `uri` (string, 필수): 읽을 리소스 URI.

## 예시

### 예시 1: URI로 서버 리소스 읽기

```
ReadMcpResource(server="github", uri="file:///repo/docs/architecture.md")
```

`github` MCP 서버가 제공하는 리소스 콘텐츠를 반환합니다.

## 참고사항

- 서버가 어떤 리소스를 노출하는지 모른다면 먼저 `ListMcpResources`를 사용하십시오. 디렉터리형 목록에는 `ReadMcpResourceDir`를 사용하십시오.
- URI 스킴은 서버별로 다릅니다(`file://`, `https://`, 사용자 정의 스킴) — 대상 서버가 광고하는 것을 확인하십시오.
