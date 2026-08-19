# SendFeedback

버그 리포트, 기능 아이디어, 누락된 기능 등 Claude Code에 대한 구조화된 피드백을 세션을 떠나지 않고 Anthropic으로 전송합니다.

## 사용 시점

- 사용자가 Claude Code 자체에 대한 버그 리포트나 피드백 전송을 요청합니다.
- 보고할 가치가 있는 명확한 제품 결함(고장난 명령, 잘못된 동작, 크래시)을 발견했습니다.
- 사용자가 존재했으면 하는 기능(아이디어 또는 누락된 기능)을 설명합니다.

## 매개변수

- `type` (string, 필수): `bug`, `idea`, `missing_capability` 중 하나.
- `title` (string, 필수): 문제에 대한 짧고 구체적인 한 줄 요약.
- `details` (string, 필수): 라벨이 붙은 글머리 항목을 다음 순서로 작성합니다: **What happened:** (관찰된 것 vs 기대한 것, 짧다면 정확한 오류 텍스트); **What the user said:** (인용, 또는 "User didn't comment; observed by the model."); **Repro:** (최소 재현 단계); **Evidence:** (요청 ID, 타임스탬프, 경로, 버전 — 없으면 생략); 선택적으로 마지막에 **Cause:** — 세션 내에서 검증된 경우에만. 글머리당 1~3줄; 서술형 문단, 추측, 비밀 정보 없음.
- `area` (string, 선택): 이 피드백이 다루는 Claude Code 부분을 명명하는 짧은 태그 (예: "hooks config", "/help", "file editing"). 불분명하면 비워 두십시오.
- `failure_mode` (string, 선택): 모델 동작 리포트의 경우 가장 가까운 실패 모드 (예: `instruction_following`, `repetition_and_looping`, `context_and_memory`, `stopping_short`, 또는 `other`). 리포트가 순수한 제품/도구 버그일 때만 생략하십시오.
- `task_category` (string, 선택): 문제 발생 시 세션이 수행 중이던 작업: `code_edit`, `debug`, `explain`, `plan`, `shell`, `search`, `review`, 또는 `other`.

## 예시

### 예시 1: 제품 버그 리포트

```
SendFeedback(
  type="bug",
  title="/export truncates the last message",
  details="**What happened:** exported transcript is missing the final assistant message.\n**What the user said:** \"the last reply never shows up in the file\".\n**Repro:** run /export after any multi-turn session.\n**Evidence:** v2.1.233, macOS.",
  area="/export",
  task_category="other"
)
```

## 참고사항

- `details`에 비밀, 토큰, 또는 개인 사용자 데이터를 포함하지 마십시오.
- 가능하면 사용자의 말을 인용하고, 그렇지 않으면 모델이 문제를 관찰했다고 명시하십시오.
- 리포트를 사실 기반으로 유지하십시오 — 근본 원인에 대한 추측은 세션 내에서 검증된 경우에만 `**Cause:**`에 넣으십시오.
