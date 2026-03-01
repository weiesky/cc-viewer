# AskUserQuestion

## 정의

실행 중 사용자에게 질문하여 확인 획득, 가설 검증 또는 결정 요청에 사용합니다.

## 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `questions` | array | 예 | 질문 목록 (1~4개 질문) |
| `answers` | object | 아니오 | 사용자로부터 수집한 답변 |
| `annotations` | object | 아니오 | 각 질문의 주석 (프리뷰 선택 비고 등) |
| `metadata` | object | 아니오 | 추적 및 분석용 메타데이터 |

각 `question` 객체:

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `question` | string | 예 | 완전한 질문 텍스트. 물음표로 끝나야 함 |
| `header` | string | 예 | 짧은 라벨 (최대 12자), 라벨 칩으로 표시 |
| `options` | array | 예 | 2~4개 선택지 |
| `multiSelect` | boolean | 예 | 다중 선택 허용 여부 |

각 `option` 객체:

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `label` | string | 예 | 선택지 표시 텍스트 (1~5단어) |
| `description` | string | 예 | 선택지 설명 |
| `markdown` | string | 아니오 | 프리뷰 콘텐츠 (ASCII 레이아웃, 코드 스니펫 등의 시각적 비교용) |

## 사용 시나리오

**적합한 경우:**
- 사용자 선호도나 요구사항 수집
- 모호한 지시 명확화
- 구현 중 결정 획득
- 사용자에게 방향 선택 제공

**적합하지 않은 경우:**
- "방안이 괜찮으신가요?"라고 묻는 경우 — ExitPlanMode를 사용해야 함

## 주의사항

- 사용자는 항상 "Other"를 선택하여 커스텀 입력을 제공할 수 있음
- 추천 선택지는 첫 번째에 배치하고 label 끝에 "(Recommended)" 추가
- `markdown` 프리뷰는 단일 선택 질문에만 지원
- `markdown`이 있는 선택지는 좌우 병렬 레이아웃으로 전환
- 계획 모드에서는 방안 확정 전 요구사항 명확화에 사용

## cc-viewer에서의 의의

AskUserQuestion 호출은 요청 로그에서 `tool_use` content block으로 나타나며, 질문과 선택지 정의가 포함됩니다. 사용자의 답변은 후속 요청의 메시지 이력에 표시됩니다.

## 원문

<textarea readonly>Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- Users will always be able to select "Other" to provide custom text input
- Use multiSelect: true to allow multiple answers to be selected for a question
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label

Plan mode note: In plan mode, use this tool to clarify requirements or choose between approaches BEFORE finalizing your plan. Do NOT use this tool to ask "Is my plan ready?" or "Should I proceed?" - use ExitPlanMode for plan approval. IMPORTANT: Do not reference "the plan" in your questions (e.g., "Do you have feedback about the plan?", "Does the plan look good?") because the user cannot see the plan in the UI until you call ExitPlanMode. If you need plan approval, use ExitPlanMode instead.

Preview feature:
Use the optional `markdown` field on options when presenting concrete artifacts that users need to visually compare:
- ASCII mockups of UI layouts or components
- Code snippets showing different implementations
- Diagram variations
- Configuration examples

When any option has a markdown, the UI switches to a side-by-side layout with a vertical option list on the left and preview on the right. Do not use previews for simple preference questions where labels and descriptions suffice. Note: previews are only supported for single-select questions (not multiSelect).
</textarea>
