# NotebookEdit

## 정의

Jupyter notebook (.ipynb 파일) 내의 특정 셀을 치환, 삽입 또는 삭제합니다.

## 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `notebook_path` | string | 예 | notebook 파일의 절대 경로 |
| `new_source` | string | 예 | 셀의 새 내용 |
| `cell_id` | string | 아니오 | 편집할 셀 ID. 삽입 모드에서는 새 셀이 이 ID 뒤에 삽입됨 |
| `cell_type` | enum | 아니오 | 셀 타입: `code` 또는 `markdown`. 삽입 모드에서 필수 |
| `edit_mode` | enum | 아니오 | 편집 모드: `replace` (기본값), `insert`, `delete` |

## 사용 시나리오

**적합한 경우:**
- Jupyter notebook 내의 코드 또는 markdown 셀 수정
- notebook에 새 셀 추가
- notebook 내의 셀 삭제

## 주의사항

- `cell_number`는 0 인덱스
- `insert` 모드는 지정 위치에 새 셀을 삽입
- `delete` 모드는 지정 위치의 셀을 삭제
- 경로는 절대 경로여야 함

## cc-viewer에서의 의의

NotebookEdit 호출은 요청 로그에서 `tool_use` content block으로 나타나며, notebook에 대한 구체적인 변경 작업이 기록됩니다.

## 원문

<textarea readonly>Completely replaces the contents of a specific cell in a Jupyter notebook (.ipynb file) with new source. Jupyter notebooks are interactive documents that combine code, text, and visualizations, commonly used for data analysis and scientific computing. The notebook_path parameter must be an absolute path, not a relative path. The cell_number is 0-indexed. Use edit_mode=insert to add a new cell at the index specified by cell_number. Use edit_mode=delete to delete the cell at the index specified by cell_number.</textarea>
