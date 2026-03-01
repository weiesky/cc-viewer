# Read

## 정의

로컬 파일 시스템에서 파일 내용을 읽습니다. 텍스트 파일, 이미지, PDF, Jupyter notebook을 지원합니다.

## 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `file_path` | string | 예 | 파일의 절대 경로 |
| `offset` | number | 아니오 | 시작 행 번호 (대용량 파일 분할 읽기용) |
| `limit` | number | 아니오 | 읽기 행 수 (대용량 파일 분할 읽기용) |
| `pages` | string | 아니오 | PDF 페이지 범위 (예: "1-5", "3", "10-20"), PDF에만 적용 |

## 사용 시나리오

**적합한 경우:**
- 코드 파일, 설정 파일 등 텍스트 파일 읽기
- 이미지 파일 보기 (Claude는 멀티모달 모델)
- PDF 문서 읽기
- Jupyter notebook 읽기 (모든 셀과 출력을 반환)
- 여러 파일을 병렬로 읽어 컨텍스트 획득

**적합하지 않은 경우:**
- 디렉토리 읽기 — Bash의 `ls` 명령을 사용해야 함
- 개방형 코드베이스 탐색 — Task (Explore 타입)를 사용해야 함

## 주의사항

- 경로는 절대 경로여야 하며 상대 경로 불가
- 기본적으로 파일의 처음 2000행을 읽음
- 2000자를 초과하는 행은 잘림
- 출력은 `cat -n` 형식이며 행 번호는 1부터 시작
- 대용량 PDF (10페이지 초과)는 `pages` 파라미터 지정 필수, 1회 최대 20페이지
- 존재하지 않는 파일 읽기는 오류를 반환 (크래시하지 않음)
- 단일 메시지 내에서 여러 Read를 병렬 호출 가능

## cc-viewer에서의 의의

Read 호출은 요청 로그에서 `tool_use` (호출)와 `tool_result` (반환 내용) content block 쌍으로 나타납니다. `tool_result`에는 파일의 실제 내용이 포함되며, 모델이 어떤 파일을 읽었는지 분석하는 데 사용할 수 있습니다.

## 원문

<textarea readonly>Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to 2000 lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters
- Any lines longer than 2000 characters will be truncated
- Results are returned using cat -n format, with line numbers starting at 1
- This tool allows Claude Code to read images (eg PNG, JPG, etc). When reading an image file the contents are presented visually as Claude Code is a multimodal LLM.
- This tool can read PDF files (.pdf). For large PDFs (more than 10 pages), you MUST provide the pages parameter to read specific page ranges (e.g., pages: "1-5"). Reading a large PDF without the pages parameter will fail. Maximum 20 pages per request.
- This tool can read Jupyter notebooks (.ipynb files) and returns all cells with their outputs, combining code, text, and visualizations.
- This tool can only read files, not directories. To read a directory, use an ls command via the Bash tool.
- You can call multiple tools in a single response. It is always better to speculatively read multiple potentially useful files in parallel.
- You will regularly be asked to read screenshots. If the user provides a path to a screenshot, ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.</textarea>
