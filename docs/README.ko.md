# CC-Viewer

Claude Code 요청 모니터링 시스템으로, Claude Code의 모든 API 요청과 응답을 실시간으로 캡처하고 시각화합니다. 개발자가 Vibe Coding 과정에서 Context를 모니터링하고 문제를 검토 및 디버깅하는 데 도움을 줍니다.

[简体中文](./README.zh.md) | [English](../README.md) | [繁體中文](./README.zh-TW.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## 사용법

```bash
npm install -g cc-viewer
```

### 실행 및 자동 구성

```bash
ccv
```

이 명령은 로컬 Claude Code 설치 방법(NPM 또는 Native Install)을 자동으로 감지하고 적응합니다.

- **NPM 설치**: Claude Code의 `cli.js`에 인터셉터 스크립트를 자동으로 주입합니다.
- **Native Install**: `claude` 바이너리를 자동으로 감지하고, 로컬 투명 프록시를 설정하며, Zsh Shell Hook을 구성하여 트래픽을 자동으로 전달합니다.

### 구성 재정의 (Configuration Override)

사용자 지정 API 엔드포인트(예: 기업 프록시)를 사용해야 하는 경우, `~/.claude/settings.json`에서 구성하거나 `ANTHROPIC_BASE_URL` 환경 변수를 설정하기만 하면 됩니다. `ccv`는 자동으로 이를 인식하고 요청을 올바르게 전달합니다.

### 자동 모드 (Silent Mode)

기본적으로 `ccv`는 `claude`를 래핑하여 실행할 때 자동 모드로 작동하여 터미널 출력을 깔끔하게 유지하고 원래 Claude Code 경험과 동일하게 합니다. 모든 로그는 백그라운드에서 캡처되며 `http://localhost:7008`에서 확인할 수 있습니다.

구성이 완료되면 평소처럼 `claude` 명령을 사용하십시오. `http://localhost:7008`을 방문하여 모니터링 인터페이스를 확인하십시오.

### 문제 해결 (Troubleshooting)

- **혼합 출력 (Mixed Output)**: `[CC-Viewer]` 디버그 로그가 Claude 출력과 섞여 보이는 경우 최신 버전으로 업데이트하세요(`npm install -g cc-viewer`).
- **연결 거부 (Connection Refused)**: `ccv` 백그라운드 프로세스가 실행 중인지 확인하세요. `ccv` 또는 `claude`(후크 설치 후)를 실행하면 자동으로 시작됩니다.
- **본문 없음 (Empty Body)**: Viewer에 "No Body"가 표시되면 비표준 SSE 형식 때문일 수 있습니다. Viewer는 이제 폴백으로 원시 콘텐츠 캡처를 지원합니다.

### 버전 확인 (Check Version)

```bash
ccv --version
```

### 제거

```bash
ccv --uninstall
```

## 기능

### 요청 모니터링 (원문 모드)

- Claude Code에서 발생하는 모든 API 요청을 실시간 캡처 (스트리밍 응답 포함)
- 왼쪽 패널에 요청 방법, URL, 소요 시간, 상태 코드 표시
- Main Agent 및 Sub Agent 요청 자동 식별 및 라벨링 (하위 유형: Bash, Task, Plan, General)
- 요청 목록이 선택된 항목으로 자동 스크롤 (모드 전환 시 중앙 정렬, 수동 클릭 시 가장 가까운 위치로 이동)
- 오른쪽 패널에서 Request / Response 탭 전환 지원
- Request Body의 `messages`, `system`, `tools` 기본 1단계 펼침
- Response Body 기본 전체 펼침
- JSON 뷰와 일반 텍스트 뷰 전환 지원
- JSON 내용 원클릭 복사
- MainAgent 요청에 Body Diff JSON 지원, 이전 MainAgent 요청과의 차이를 접어서 표시 (변경/추가된 필드만 표시)
- Diff 섹션에서 JSON/Text 뷰 전환 및 원클릭 복사 지원
- "Expand Diff" 설정: 활성화 시 MainAgent 요청의 Diff 섹션이 자동으로 펼쳐짐
- Body Diff JSON 툴팁은 닫기 가능하며, 닫으면 서버 측에 환경설정이 저장되어 다시 표시되지 않습니다
- 민감한 헤더(`x-api-key`, `authorization`)가 JSONL 로그 파일에서 자동으로 마스킹되어 자격 증명 유출 방지
- 요청별 인라인 Token 사용량 통계 (입력/출력 Token, 캐시 생성/읽기, 적중률)
- Claude Code Router(CCR) 및 기타 프록시 환경 호환 — API 경로 패턴을 통한 폴백 매칭

### 대화 모드

오른쪽 상단의 "대화 모드" 버튼을 클릭하여 Main Agent의 전체 대화 기록을 채팅 인터페이스로 파싱:

- 사용자 메시지 오른쪽 정렬 (파란색 말풍선), Main Agent 응답 왼쪽 정렬 (어두운 말풍선), Markdown 렌더링 지원
- `/compact` 메시지 자동 감지 및 접힌 상태로 표시, 클릭하여 전체 요약 펼치기
- 도구 호출 결과가 해당 Assistant 메시지 내부에 인라인 표시
- `thinking` 블록 기본 접힘, Markdown으로 렌더링, 클릭하여 사고 과정 확인; 원클릭 번역 지원
- `tool_use`가 컴팩트한 도구 호출 카드로 표시 (Bash, Read, Edit, Write, Glob, Grep, Task 등 전용 표시)
- Task(SubAgent) 도구 결과가 Markdown으로 렌더링
- 사용자 선택 메시지 (AskUserQuestion) Q&A 형식으로 표시
- 시스템 태그 (`<system-reminder>`, `<project-reminder>` 등) 자동 접힘
- Skill 로드 메시지 자동 감지 및 접기, Skill 이름 표시; 클릭하여 전체 문서 확인 (Markdown 렌더링)
- Skills reminder 자동 감지 및 접기
- 시스템 텍스트 자동 필터링, 실제 사용자 입력만 표시
- 다중 session 분할 표시 (`/compact`, `/clear` 등 작업 후 자동 분할)
- 각 메시지에 초 단위 정확한 타임스탬프 표시, API 요청 타이밍 기반 추산
- 각 메시지에 "요청 보기" 링크가 있어 해당 API 요청의 원문 모드로 바로 이동 가능
- 양방향 모드 동기화: 대화 모드로 전환 시 선택된 요청에 해당하는 대화로 스크롤; 원문 모드로 전환 시 선택된 요청으로 스크롤
- 설정 패널: 도구 결과 및 사고 블록의 기본 접힘 상태 전환
- 전역 설정: 무관한 요청(count_tokens, 하트비트) 필터링 전환

### 번역

- thinking 블록과 Assistant 메시지 원클릭 번역 지원
- Claude Haiku API 기반, `x-api-key` 인증만 사용 (OAuth 세션 토큰은 컨텍스트 오염 방지를 위해 제외)
- mainAgent 요청에서 haiku 모델명 자동 캡처; 기본값 `claude-haiku-4-5-20251001`
- 번역 결과 자동 캐시, 다시 클릭하면 원문으로 전환
- 번역 중 로딩 스피너 애니메이션 표시
- 요청 상세의 `authorization` 헤더 옆 (?) 아이콘으로 컨텍스트 오염 설명 문서 확인 가능

### Token 소비 통계

헤더 영역의 호버 패널:

- 모델별 input/output token 수량 그룹 통계
- Cache creation/read 수량 및 캐시 적중률 표시
- 캐시 재구축 원인별 통계 (TTL, system/tools/model 변경, 메시지 잘림/수정, key 변경) — 횟수 및 cache_creation 토큰 표시
- 도구 사용 통계: 도구별 호출 횟수, 빈도순 정렬
- Skill 사용 통계: Skill별 호출 횟수를 빈도순으로 표시
- 개념 도움말 (?) 아이콘: 클릭하면 MainAgent, CacheRebuild 및 각 도구의 내장 문서를 볼 수 있음
- Main Agent 캐시 만료 카운트다운

### 로그 관리

왼쪽 상단 CC-Viewer 드롭다운 메뉴:

- 로컬 로그 가져오기: 프로젝트별 그룹화된 기록 로그 파일 탐색, 새 창에서 열기
- 로컬 JSONL 파일 불러오기: 로컬 `.jsonl` 파일을 직접 선택하여 불러오기 (최대 500MB)
- 현재 로그 다운로드: 현재 모니터링 중인 JSONL 로그 파일 다운로드
- 로그 병합: 여러 JSONL 로그 파일을 하나의 세션으로 병합하여 통합 분석
- 사용자 Prompt 보기: 모든 사용자 입력을 추출하여 세 가지 보기 모드로 표시 — 원문 모드(원본 내용), 컨텍스트 모드(시스템 태그 접기 가능), Text 모드(순수 텍스트); 슬래시 명령(`/model`, `/context` 등)은 독립 항목으로 표시; 명령 관련 태그는 Prompt 내용에서 자동 숨김

### 다국어 지원

CC-Viewer는 18개 언어를 지원하며, 시스템 로케일에 따라 자동 전환됩니다:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
