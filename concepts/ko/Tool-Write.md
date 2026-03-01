# Write

## 정의

로컬 파일 시스템에 내용을 씁니다. 파일이 이미 존재하면 덮어씁니다.

## 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `file_path` | string | 예 | 파일의 절대 경로 (절대 경로여야 함) |
| `content` | string | 예 | 쓸 내용 |

## 사용 시나리오

**적합한 경우:**
- 새 파일 생성
- 파일 내용을 완전히 재작성해야 하는 경우

**적합하지 않은 경우:**
- 파일 내 부분적인 내용 수정 — Edit를 사용해야 함
- 문서 파일 (*.md)이나 README를 자발적으로 생성하지 말 것. 사용자가 명시적으로 요청한 경우를 제외

## 주의사항

- 대상 파일이 이미 존재하면 먼저 Read로 읽어야 함. 그렇지 않으면 실패
- 기존 파일의 전체 내용을 덮어씀
- 기존 파일 편집에는 Edit를 우선 사용하고, Write는 새 파일 생성 또는 완전한 재작성에만 사용

## cc-viewer에서의 의의

Write 호출은 요청 로그에서 `tool_use` content block으로 나타나며, `input.content`에 쓰여진 전체 내용이 포함됩니다.

## 원문

<textarea readonly>Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.</textarea>
