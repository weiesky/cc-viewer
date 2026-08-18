# SuggestPluginInstall

`SearchPlugins` 결과에서 인라인 플러그인 설치 카드를 렌더링하여, 플러그인 제안을 사용자의 요청에 연결합니다.

## 사용 시점

- 플러그인 검색이 사용자가 하려는 것과 일치하는 플러그인을 드러냈고, 이를 설치용으로 제공하고 싶습니다.

## 매개변수

- `contextLabel` (string, 필수): 제안을 사용자 요청에 연결하는 짧은 헤더 (최대 128자).
- `plugins` (array, 필수): `SearchPlugins` 결과에서 가져온 플러그인 — 1-16개 항목, 각각:
  - `pluginId` (string, 필수)
  - `pluginName` (string, 필수)
  - `description` (string, 필수)
  - `skills` (array, 선택): 플러그인의 스킬을 설명하는 최대 32개의 `{name, description?}` 항목.

## 예시

### 예시 1: 일치하는 플러그인 제공

```
SuggestPluginInstall(
  contextLabel="For reviewing pull requests",
  plugins=[{pluginId="pr-toolkit", pluginName="PR Toolkit", description="Review helpers"}]
)
```

카드가 사용자에게 렌더링됩니다. 플러그인 활성화는 별도로 이루어집니다. 후속 조치로 `ListPlugins`를 호출하여 실제로 설치된 것을 확인하십시오.

## 참고사항

- 검색 결과에서 나온 플러그인만 포함하십시오 — 플러그인 항목을 발명하지 마십시오.
- HIPAA 엔터프라이즈 구성에서는 비활성화됩니다.
