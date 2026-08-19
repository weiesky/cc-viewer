# AskUserQuestion

채팅 UI 내에서 사용자에게 하나 이상의 구조화된 객관식 질문을 제시하고, 선택 항목을 수집하여 어시스턴트에게 반환합니다 — 자유 형식의 왕복 대화 없이 의도를 명확히 하는 데 유용합니다.

## 사용 시점

- 요청에 여러 합리적인 해석이 있으며 진행하기 전에 사용자가 하나를 선택해야 합니다.
- 사용자가 자유 텍스트 답변이 오류가 나기 쉬운 구체적인 옵션 (프레임워크, 라이브러리, 파일 경로, 전략) 중에서 선택해야 합니다.
- 미리보기 창을 사용하여 대안을 나란히 비교하고 싶습니다.
- 여러 관련 결정을 하나의 프롬프트로 일괄 처리하여 왕복을 줄일 수 있습니다.
- 계획이나 도구 호출이 사용자가 아직 지정하지 않은 구성에 의존합니다.

## 매개변수

- `questions` (array, 필수): 단일 프롬프트에서 함께 표시되는 1개에서 4개의 질문. 각 질문 객체에는 다음이 포함됩니다:
  - `question` (string, 필수): 물음표로 끝나는 전체 질문 텍스트.
  - `header` (string, 필수): 질문 위에 칩으로 렌더링되는 짧은 레이블 (최대 12자).
  - `options` (array, 필수): 2개에서 4개의 옵션 객체. 각 옵션에는 `label` (1-5단어), `description`, 선택적인 `markdown` 미리보기가 있습니다.
  - `multiSelect` (boolean, 필수): `true`인 경우 사용자가 하나 이상을 선택할 수 있습니다.

## 예시

### 예시 1: 단일 프레임워크 선택

```
AskUserQuestion(questions=[{
  "header": "Test runner",
  "question": "Which test runner should I configure?",
  "multiSelect": false,
  "options": [
    {"label": "Vitest (Recommended)", "description": "Fast, Vite-native, Jest-compatible API"},
    {"label": "Jest",                  "description": "Mature, broadest plugin ecosystem"},
    {"label": "Node --test",           "description": "Zero dependencies, built in"}
  ]
}])
```

### 예시 2: 두 레이아웃의 나란히 미리보기

```
AskUserQuestion(questions=[{
  "header": "Layout",
  "question": "Which dashboard layout do you prefer?",
  "multiSelect": false,
  "options": [
    {"label": "Sidebar",  "description": "Nav on the left", "markdown": "```\n+------+---------+\n| NAV  | CONTENT |\n+------+---------+\n```"},
    {"label": "Top bar",  "description": "Nav across top",  "markdown": "```\n+-----------------+\n|       NAV       |\n+-----------------+\n|     CONTENT     |\n+-----------------+\n```"}
  ]
}])
```

## 참고사항

- UI는 모든 질문에 "Other" 자유 텍스트 옵션을 자동으로 추가합니다. 자체 "Other", "None", "Custom" 항목을 추가하지 마십시오 — 내장된 이스케이프 해치와 중복됩니다.
- 각 호출을 1개에서 4개의 질문으로, 각 질문을 2개에서 4개의 옵션으로 제한하십시오. 이 범위를 초과하면 하니스에 의해 거부됩니다.
- 특정 옵션을 추천하는 경우 먼저 배치하고 레이블에 "(Recommended)"를 추가하여 UI가 선호되는 경로를 강조 표시하도록 하십시오.
- `markdown` 필드를 통한 미리보기는 단일 선택 질문에서만 지원됩니다. ASCII 레이아웃, 코드 스니펫, 구성 차이와 같은 시각적 아티팩트에 사용하십시오 — 레이블과 설명으로 충분한 간단한 선호도 질문에는 사용하지 마십시오.
- 질문의 옵션에 `markdown` 값이 있으면 UI는 왼쪽에 옵션 목록, 오른쪽에 미리보기가 있는 나란히 배치된 레이아웃으로 전환됩니다.
- "이 계획이 괜찮아 보이나요?"를 묻기 위해 `AskUserQuestion`을 사용하지 마십시오 — 계획 승인을 위해 존재하는 `ExitPlanMode`를 호출하십시오. 계획 모드에서는 질문 텍스트에 "계획"을 언급하는 것도 피하십시오. `ExitPlanMode`가 실행될 때까지 계획이 사용자에게 보이지 않기 때문입니다.
- API 키나 비밀번호와 같은 민감한 정보나 자유 형식 입력을 요청하는 데 이 도구를 사용하지 마십시오. 대신 채팅에서 질문하십시오.
