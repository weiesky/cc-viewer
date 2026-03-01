# Edit

## 정의

정확한 문자열 치환을 통한 파일 편집. 파일 내의 `old_string`을 `new_string`으로 치환합니다.

## 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `file_path` | string | 예 | 수정할 파일의 절대 경로 |
| `old_string` | string | 예 | 치환할 원본 텍스트 |
| `new_string` | string | 예 | 치환 후 새 텍스트 (old_string과 달라야 함) |
| `replace_all` | boolean | 아니오 | 모든 매치를 치환할지 여부, 기본값 `false` |

## 사용 시나리오

**적합한 경우:**
- 기존 파일 내 특정 코드 섹션 수정
- 버그 수정, 로직 업데이트
- 변수 이름 변경 (`replace_all: true`와 함께 사용)
- 파일 내용을 정확하게 수정해야 하는 모든 시나리오

**적합하지 않은 경우:**
- 새 파일 생성 — Write를 사용해야 함
- 대규모 재작성 — Write로 전체 파일을 덮어써야 할 수 있음

## 주의사항

- 사용 전 반드시 Read로 해당 파일을 읽어야 하며, 그렇지 않으면 오류 발생
- `old_string`은 파일 내에서 유일해야 함. 유일하지 않으면 더 많은 컨텍스트를 포함하여 유일하게 만들거나 `replace_all`을 사용
- 텍스트 편집 시 원본 들여쓰기 (tab/공백)를 유지해야 함. Read 출력의 행 번호 접두사를 포함하지 말 것
- 새 파일 생성보다 기존 파일 편집을 우선
- `new_string`은 `old_string`과 달라야 함

## cc-viewer에서의 의의

Edit 호출은 요청 로그에서 `tool_use` content block으로 나타나며, `input`에 `old_string`과 `new_string`이 포함됩니다. 모델이 파일에 대해 수행한 변경 사항을 추적하는 데 사용할 수 있습니다.

## 원문

<textarea readonly>Performs exact string replacements in files.

Usage:
- You must use your `Read` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file. 
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if `old_string` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use `replace_all` to change every instance of `old_string`.
- Use `replace_all` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.</textarea>
