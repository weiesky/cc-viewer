# SuggestSkills

사용자가 추가할 수 있는 독립형 스킬(아직 활성화되지 않은 스킬)의 카드를 주제 키워드에 기반하여 렌더링합니다.

## 사용 시점

- 사용자의 요청이 활성화되지 않은 스킬과 일치합니다(사용자가 요청했을 때는 `trigger="user_asked"`, 요청 없이 제안할 때는 `trigger="proactive"`).

## 활성화

- 원격 제어 클라이언트가 연결되어 있거나 세션이 관리형 클라우드 환경에서 실행될 때만 사용할 수 있습니다.
- HIPAA 엔터프라이즈 구성에서는 비활성화됩니다.
- brief 모드에서는 제공되지 않습니다.

## 매개변수

- `keywords` (array of strings, 필수): 사용자 요청의 주제 키워드. 1-8개 항목, 각각 1-64자.
- `contextLabel` (string, 선택): 제안을 요청에 연결하는 짧은 라벨 (최대 128자).
- `trigger` (string, 선택): 이 제안이 어떻게 시작되었는지 — `user_asked` 또는 `proactive`.

## 예시

### 예시 1: 주제별 스킬 제안

```
SuggestSkills(keywords=["data visualization", "charts"], contextLabel="For building the dashboard", trigger="user_asked")
```

이미 활성화된 스킬은 결과에서 필터링됩니다.

## 참고사항

- 제안 카드만 렌더링합니다 — 스킬 추가는 별도로 이루어집니다. 이후 `ListSkills`를 호출하여 확인하십시오.
