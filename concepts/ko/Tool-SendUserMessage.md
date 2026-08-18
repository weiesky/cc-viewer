# SendUserMessage

사용자에게 메시지를 전송합니다 — brief 스타일 세션에서의 주요 가시적 출력 채널. 레거시 별칭 `Brief`로도 알려져 있습니다.

## 사용 시점

- 사용자가 방금 말한 것에 답장합니다(`status="normal"`).
- 사용자가 요청하지 않았지만 지금 봐야 하는 것을 선제적으로 표시합니다 — 자리를 비운 동안 태스크 완료, 부딪힌 블로커, 요청되지 않은 상태 업데이트(`status="proactive"`).

## 매개변수

brief 모드에서:

- `message` (string, 필수): 사용자에게 보낼 메시지. markdown 형식을 지원합니다.
- `attachments` (array, 선택): 메시지와 함께 표시되는 첨부 파일. 각 항목은 로컬에서 읽을 수 있는 파일의 파일 경로(절대 경로 또는 cwd 기준), 또는 `attach_file`과 같은 장치 도구에서 얻은 미리 해석된 `{file_uuid, file_name, size, is_image}` 객체입니다.
- `status` (string, 필수): 사용자가 지금 필요로 하는 요청되지 않은 업데이트는 `proactive`; 사용자에게 답장할 때는 `normal`.

non-brief 빌드에서는 `message`만 사용할 수 있습니다.

## 예시

### 예시 1: 선제적 완료 알림

```
SendUserMessage(
  message="The migration finished — 42 files updated, tests green.",
  status="proactive"
)
```

## 참고사항

- brief 모드 또는 해당 기능 롤아웃을 통해서만 활성화됩니다. 대부분의 대화형 CLI 세션은 대신 사용자에게 직접 말합니다.
- `proactive`는 아껴서 사용하십시오 — 지금 정말 사용자의 주의가 필요한 것에만 쓰입니다.
