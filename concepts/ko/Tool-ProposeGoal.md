# ProposeGoal

세션의 검증 가능한 완료 목표를 제안합니다. 목표는 (기본적으로) 승인 대화상자로 사용자에게 표시되며, 일단 설정되면 나머지 대화를 확인 가능한 결과로 이끕니다.

## 사용 시점

- 세션에 평가자가 대화에서 확인할 수 있는 구체적인 종료 상태가 있습니다 (예: "all tests in test/auth pass").
- 상당한 작업을 하기 전에 "완료"가 무엇을 의미하는지 사용자의 명시적인 동의를 얻고 싶습니다.
- 사용자 자신의 말로 결과가 이미 명시되어 있고 이를 세션 목표로 기록하고 싶습니다.

## 활성화

- 기본적으로 꺼져 있습니다(서버 측 기능 플래그).
- 대화형 및 백그라운드 세션에서 제외됩니다.
- `modelProposedGoals: "disabled"` 설정 키로 꺼집니다.

## 매개변수

- `condition` (string, 필수): 별도의 평가자가 대화에서 확인할 수 있도록 작성된 완료 조건 (예: "all tests in test/auth pass (bun test exits 0)"). 최대 500자 — 승인 대화상자에서 사용자가 전체 조건을 읽을 수 있어야 합니다.
- `ask_user` (boolean, 선택): 목표가 설정되기 전에 사용자에게 승인을 요청할지 여부. 기본값 true (승인 대화상자가 표시됨). 이 대화에서 사용자 자신의 말로 이 결과를 원한다고 명시한 경우에만 false로 설정하십시오. 목표는 가시적인 안내와 함께 직접 설정되고, 사용자는 `/goal clear`로 지울 수 있습니다.

## 예시

### 예시 1: 테스트로 뒷받침되는 목표 제안

```
ProposeGoal(condition="npm run test exits 0 with the new catalog cases included")
```

사용자는 승인 대화상자에서 조건을 보고 수락, 편집, 또는 거부할 수 있습니다.

### 예시 2: 사용자가 명시한 결과 직접 채택

```
ProposeGoal(condition="the login form validates email format and shows an inline error", ask_user=false)
```

사용자가 대화에서 앞서 그 결과를 명시적으로 말했기 때문에 유효합니다.

## 참고사항

- `condition`을 짧고 객관적으로 확인 가능하게 유지하십시오 — 모호한 목표("더 좋게 만들기")는 목적을 무색하게 만듭니다.
- `ask_user=false`는 사용자가 스스로 명시한 결과에만 엄격히 제한됩니다. 그 외의 모든 것은 승인 대화상자를 거쳐야 합니다.
