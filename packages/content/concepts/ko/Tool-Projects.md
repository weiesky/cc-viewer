# Projects

사용자의 Claude 프로젝트 지식 베이스에 있는 프로젝트 문서를 관리합니다: 문서 읽기, 검색, 쓰기, 삭제, 또는 프로젝트 정보 가져오기.

## 사용 시점

- 문서(산출물, 노트, 참고 자료)를 사용자의 프로젝트에 영속화하여 세션이 끝나도 남도록 합니다.
- 기존 프로젝트 문서를 읽거나 검색하여 현재 태스크를 이전 컨텍스트에 근거시키려고 합니다.
- 로컬 파일을 그 내용을 컨텍스트에 로드하지 않고 프로젝트에 업로드합니다.
- 오래된 프로젝트 문서를 제거합니다.

## 매개변수

- `method` (string, 필수): `project_info`, `project_read`, `project_search`, `project_write`, `project_delete` 중 하나.
- `path` (string, 선택): `project_read`/`project_write`/`project_delete`의 경우: 문서 경로. `project_write`의 경우: 기존 경로는 그 자리에서 대체되고, 새 단순 파일명("/" 없음)은 `claude/<name>`으로 네임스페이스됩니다.
- `content` (string, 선택): `project_write`의 경우: 인라인 문서 텍스트. `local_path`와 상호 배타적입니다.
- `local_path` (string, 선택): `project_write`의 경우: 작업 디렉터리 안의 파일을 업로드 — 내용은 컨텍스트에 절대 들어오지 않습니다. `content`와 상호 배타적입니다.
- `present_to_user` (boolean, 선택): `project_write`의 경우: 이 문서를 사용자가 봐야 하는 산출물로 표시합니다. 기본값 false. 일상적인 저장과 일괄 쓰기에는 설정하지 않은 채로 두십시오.
- `query` (string, 선택): `project_search`의 경우: 지식 베이스 쿼리.
- `n` (number, 선택): `project_search`의 경우: 히트 수 (기본값 5).

## 예시

### 예시 1: 산출물을 프로젝트에 쓰기

```
Projects(
  method="project_write",
  path="claude/migration-plan.md",
  local_path="./migration-plan.md",
  present_to_user=true
)
```

로컬 파일의 내용을 컨텍스트로 끌어오지 않고 업로드하며, 사용자의 산출물로 표시합니다.

### 예시 2: 지식 베이스 검색

```
Projects(method="project_search", query="authentication refresh tokens", n=5)
```

## 참고사항

- `content`는 인라인으로 작성하는 텍스트용이고 `local_path`는 이미 디스크에 있는 모든 것용입니다 — 둘을 섞지 마십시오.
- `present_to_user=true`는 아껴서 사용하십시오: 사용자가 요청했거나 반드시 조치해야 하는 문서 하나에만 사용하십시오.
