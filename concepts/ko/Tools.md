# Claude Code 도구 목록

Claude Code는 Anthropic API의 tool_use 메커니즘을 통해 모델에 일련의 내장 도구를 제공합니다. 각 MainAgent 요청의 `tools` 배열에 이러한 도구의 완전한 JSON Schema 정의가 포함되며, 모델은 응답 내의 `tool_use` content block으로 이를 호출합니다.

다음은 모든 도구의 카테고리별 인덱스입니다.

## Agent 시스템

| 도구 | 용도 |
|------|------|
| [Task](Tool-Task.md) | 서브 agent (SubAgent)를 시작하여 복잡한 다단계 태스크 처리 |
| [TaskOutput](Tool-TaskOutput.md) | 백그라운드 태스크의 출력 가져오기 |
| [TaskStop](Tool-TaskStop.md) | 실행 중인 백그라운드 태스크 중지 |
| [TaskCreate](Tool-TaskCreate.md) | 구조화된 태스크 리스트 항목 생성 |
| [TaskGet](Tool-TaskGet.md) | 태스크 상세 정보 가져오기 |
| [TaskUpdate](Tool-TaskUpdate.md) | 태스크 상태, 의존 관계 등 업데이트 |
| [TaskList](Tool-TaskList.md) | 모든 태스크 목록 표시 |

## 파일 작업

| 도구 | 용도 |
|------|------|
| [Read](Tool-Read.md) | 파일 내용 읽기 (텍스트, 이미지, PDF, Jupyter notebook 지원) |
| [Edit](Tool-Edit.md) | 정확한 문자열 치환으로 파일 편집 |
| [Write](Tool-Write.md) | 파일 쓰기 또는 덮어쓰기 |
| [NotebookEdit](Tool-NotebookEdit.md) | Jupyter notebook 셀 편집 |

## 검색

| 도구 | 용도 |
|------|------|
| [Glob](Tool-Glob.md) | 파일명 패턴 매칭으로 파일 검색 |
| [Grep](Tool-Grep.md) | ripgrep 기반 파일 내용 검색 |

## 터미널

| 도구 | 용도 |
|------|------|
| [Bash](Tool-Bash.md) | 셸 명령 실행 |

## Web

| 도구 | 용도 |
|------|------|
| [WebFetch](Tool-WebFetch.md) | 웹페이지 내용을 가져와 AI로 처리 |
| [WebSearch](Tool-WebSearch.md) | 검색 엔진 쿼리 |

## 계획 및 상호작용

| 도구 | 용도 |
|------|------|
| [EnterPlanMode](Tool-EnterPlanMode.md) | 계획 모드 진입, 구현 방안 설계 |
| [ExitPlanMode](Tool-ExitPlanMode.md) | 계획 모드 종료 및 방안을 사용자 승인에 제출 |
| [AskUserQuestion](Tool-AskUserQuestion.md) | 사용자에게 질문하여 확인 또는 결정 획득 |

## 확장

| 도구 | 용도 |
|------|------|
| [Skill](Tool-Skill.md) | 스킬 (slash command) 실행 |

## IDE 통합

| 도구 | 용도 |
|------|------|
| [getDiagnostics](Tool-getDiagnostics.md) | VS Code 언어 진단 정보 가져오기 |
| [executeCode](Tool-executeCode.md) | Jupyter kernel에서 코드 실행 |
