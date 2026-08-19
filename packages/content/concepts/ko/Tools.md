# Claude Code 도구 목록

Claude Code는 Anthropic API의 tool_use 메커니즘을 통해 모델에 일련의 내장 도구를 제공합니다. 각 MainAgent 요청의 `tools` 배열에 이러한 도구의 완전한 JSON Schema 정의가 포함되며, 모델은 응답 내의 `tool_use` content block으로 이를 호출합니다.

다음은 모든 도구의 카테고리별 인덱스입니다.

## Agent 시스템

| 도구 | 용도 |
|------|------|
| [Agent](Tool-Agent.md) | 서브 agent (SubAgent)를 시작하여 복잡한 다단계 태스크 처리 |
| [TaskOutput](Tool-TaskOutput.md) | 백그라운드 태스크의 출력 가져오기 |
| [TaskStop](Tool-TaskStop.md) | 실행 중인 백그라운드 태스크 중지 |
| [TaskCreate](Tool-TaskCreate.md) | 구조화된 태스크 리스트 항목 생성 |
| [TaskGet](Tool-TaskGet.md) | 태스크 상세 정보 가져오기 |
| [TaskUpdate](Tool-TaskUpdate.md) | 태스크 상태, 의존 관계 등 업데이트 |
| [TaskList](Tool-TaskList.md) | 모든 태스크 목록 표시 |
| [ListAgents](Tool-ListAgents.md) | 세션에서 사용 가능한 agent 목록 표시 |

## 파일 작업

| 도구 | 용도 |
|------|------|
| [Read](Tool-Read.md) | 파일 내용 읽기 (텍스트, 이미지, PDF, Jupyter notebook 지원) |
| [Edit](Tool-Edit.md) | 정확한 문자열 치환으로 파일 편집 |
| [Write](Tool-Write.md) | 파일 쓰기 또는 덮어쓰기 |
| [NotebookEdit](Tool-NotebookEdit.md) | Jupyter notebook 셀 편집 |

## 팀 및 협력

| 도구 | 용도 |
|------|------|
| [SendMessage](Tool-SendMessage.md) | 다른 agent에게 메시지 전송 |
| [Workflow](Tool-Workflow.md) | 결정론적 다중 agent 오케스트레이션 스크립트 실행 |
| [Monitor](Tool-Monitor.md) | 장시간 실행 스크립트의 이벤트를 알림으로 스트리밍 |
| [SendFile](Tool-SendFile.md) | 다른 Claude Code 세션으로 파일 전송 |
| [SendUserFile](Tool-SendUserFile.md) | 사용자에게 파일 전송 |
| [SendUserMessage](Tool-SendUserMessage.md) | 사용자에게 메시지 전송 (레거시 Brief 도구) |
| [EndConversation](Tool-EndConversation.md) | 현재 대화 종료 |

## 검색

| 도구 | 용도 |
|------|------|
| [Glob](Tool-Glob.md) | 파일명 패턴 매칭으로 파일 검색 |
| [Grep](Tool-Grep.md) | ripgrep 기반 파일 내용 검색 |
| [ToolSearch](Tool-ToolSearch.md) | 요청 시 지연/MCP 도구 검색 및 로드 |

## 터미널

| 도구 | 용도 |
|------|------|
| [Bash](Tool-Bash.md) | 셸 명령 실행 |
| [REPL](Tool-REPL.md) | 영속적인 Node.js REPL에서 JavaScript 실행 |

## Web

| 도구 | 용도 |
|------|------|
| [WebFetch](Tool-WebFetch.md) | 웹페이지 내용을 가져와 AI로 처리 |
| [WebSearch](Tool-WebSearch.md) | 검색 엔진 쿼리 |
| [Artifact](Tool-Artifact.md) | HTML/Markdown 파일을 호스팅된 claude.ai 웹페이지로 발행 |
| [DesignSync](Tool-DesignSync.md) | 로컬 컴포넌트 라이브러리를 claude.ai 설계 시스템 프로젝트와 동기화 |

## 계획 및 상호작용

| 도구 | 용도 |
|------|------|
| [EnterPlanMode](Tool-EnterPlanMode.md) | 계획 모드 진입, 구현 방안 설계 |
| [ExitPlanMode](Tool-ExitPlanMode.md) | 계획 모드 종료 및 방안을 사용자 승인에 제출 |
| [AskUserQuestion](Tool-AskUserQuestion.md) | 사용자에게 질문하여 확인 또는 결정 획득 |
| [ReportFindings](Tool-ReportFindings.md) | 코드 리뷰 발견사항을 호스트 UI의 타입화된 목록으로 보고 |
| [TodoWrite](Tool-TodoWrite.md) | 세션용 구조화된 todo 리스트 작성 |
| [SendFeedback](Tool-SendFeedback.md) | Claude Code에 대한 구조화된 피드백을 Anthropic으로 전송 |
| [Projects](Tool-Projects.md) | 프로젝트 지식 베이스 문서 관리 |
| [ProposeGoal](Tool-ProposeGoal.md) | 세션의 검증 가능한 완료 목표 제안 |

## 작업 트리

| 도구 | 용도 |
|------|------|
| [EnterWorktree](Tool-EnterWorktree.md) | 세션용 격리된 git worktree 생성 또는 진입 |
| [ExitWorktree](Tool-ExitWorktree.md) | worktree 세션 종료, 유지 또는 제거 |

## 스케줄링 및 알림

| 도구 | 용도 |
|------|------|
| [CronCreate](Tool-CronCreate.md) | cron 표현식에서 프롬프트 스케줄 (반복 또는 일회성) |
| [CronDelete](Tool-CronDelete.md) | 스케줄된 cron 작업 취소 |
| [CronList](Tool-CronList.md) | 스케줄된 cron 작업 목록 표시 |
| [ScheduleWakeup](Tool-ScheduleWakeup.md) | 다음 웨이크업을 스케줄하여 /loop 반복 자동 조정 |
| [PushNotification](Tool-PushNotification.md) | 사용자에게 데스크톱/모바일 알림 전송 |
| [RemoteTrigger](Tool-RemoteTrigger.md) | claude.ai 원격 트리거 루틴 관리 |
| [ReadNotifications](Tool-ReadNotifications.md) | 보류 중인 세션 알림 읽기 |

## 확장

| 도구 | 용도 |
|------|------|
| [Skill](Tool-Skill.md) | 스킬 (slash command) 실행 |

## MCP 및 확장

| 도구 | 용도 |
|------|------|
| [ListMcpResources](Tool-ListMcpResources.md) | 연결된 MCP 서버가 노출하는 리소스 목록 표시 |
| [ReadMcpResource](Tool-ReadMcpResource.md) | URI로 단일 MCP 서버 리소스 읽기 |
| [ReadMcpResourceDir](Tool-ReadMcpResourceDir.md) | URI로 디렉터리형 MCP 리소스 나열 |
| [SearchMcpRegistry](Tool-SearchMcpRegistry.md) | 키워드로 MCP 커넥터 레지스트리 검색 |
| [SuggestConnectors](Tool-SuggestConnectors.md) | 레지스트리 검색 결과에서 커넥터 상세 정보 확인 |
| [ListConnectors](Tool-ListConnectors.md) | 설치된 MCP 커넥터 목록 표시 |
| [SuggestPluginInstall](Tool-SuggestPluginInstall.md) | 인라인 플러그인 설치 카드 렌더링 |
| [SuggestSkills](Tool-SuggestSkills.md) | 추가 가능한 스킬 카드 렌더링 |
| [ListPlugins](Tool-ListPlugins.md) | 활성화된 claude.ai 플러그인 목록 표시 |
| [ListSkills](Tool-ListSkills.md) | 활성화된 claude.ai 스킬 목록 표시 |

## IDE 통합

| 도구 | 용도 |
|------|------|
| [LSP](Tool-LSP.md) | 언어 서버 쿼리 (정의, 참조, 기호) |
