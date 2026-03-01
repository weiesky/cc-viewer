# TaskStop

## 정의

실행 중인 백그라운드 태스크를 중지합니다.

## 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `task_id` | string | 아니오 | 중지할 백그라운드 태스크 ID |
| `shell_id` | string | 아니오 | 더 이상 사용되지 않음, `task_id`를 대신 사용 |

## 사용 시나리오

**적합한 경우:**
- 더 이상 필요 없는 장시간 실행 태스크 종료
- 잘못 시작한 백그라운드 태스크 취소

## 주의사항

- 성공 또는 실패 상태를 반환
- `shell_id` 파라미터는 더 이상 사용되지 않으며, `task_id`를 사용해야 함

## cc-viewer에서의 의의

TaskStop 호출 자체는 API 요청을 생성하지 않으며, Claude Code 내부 태스크 관리 작업입니다.

## 원문

<textarea readonly>
- Stops a running background task by its ID
- Takes a task_id parameter identifying the task to stop
- Returns a success or failure status
- Use this tool when you need to terminate a long-running task
</textarea>
