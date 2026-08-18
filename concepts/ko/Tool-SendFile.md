# SendFile

하나 이상의 파일을 다른 Claude Code 세션으로 전송합니다 — `ListAgents`에 나열된 피어, 또는 명시적인 세션 주소.

## 사용 시점

- 피어 세션이 자신의 태스크를 계속하기 위해 작업 디렉터리의 파일(리포트, 패치, 픽스처)이 필요합니다.
- 세션 간에 작업을 조율하며 텍스트가 아닌 산출물을 넘기고 싶습니다(텍스트에는 `SendMessage`를 사용하십시오).

## 매개변수

- `to` (string, 필수): 수신자 — `ListAgents`의 피어 세션 이름, 또는 명시적인 `uds:<socket>` / `bridge:<session id>` 주소.
- `files` (array of strings, 필수): 전송할 파일 경로(절대 경로 또는 cwd 기준). 단일 파일이라도 항상 배열을 전달하십시오. 1-16개 파일, 각각 최대 30 MiB.
- `message` (string, 선택): 파일과 함께 전달되는 짧은 메시지.

## 예시

### 예시 1: 피어 세션에 리포트 전송

```
SendFile(
  to="teammate-a",
  files=["./dist/report.html"],
  message="The analysis you asked for"
)
```

## 참고사항

- 세션에서 세션 간 파일 전송이 사용 가능해야 합니다. 그렇지 않으면 "Cross-session file transfer is not available in this session."으로 검증이 실패합니다.
- 원격 머신으로의 전송은 추가 승인이 필요할 수 있습니다.
- 파일 내용 읽기는 전송의 일부입니다 — 권한 규칙으로 파일 읽기가 비활성화되어 있으면 거부됩니다.
