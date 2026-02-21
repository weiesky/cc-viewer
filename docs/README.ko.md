# CC-Viewer

Claude Code 요청 모니터링 시스템으로, Claude Code의 모든 API 요청과 응답을 실시간으로 캡처하고 시각화합니다. 개발자가 Vibe Coding 과정에서 Context를 모니터링하고 문제를 검토 및 디버깅하는 데 도움을 줍니다.

[简体中文](./README.zh.md) | [English](../README.md) | [繁體中文](./README.zh-TW.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## 사용법

```bash
npm install -g cc-viewer
```

설치 후 실행:

```bash
ccv
```

이 명령은 로컬에 설치된 Claude Code를 자동으로 모니터링용으로 설정하고, shell 설정 파일(`~/.zshrc` 또는 `~/.bashrc`)에 자동 복구 hook을 추가합니다. 이후 Claude Code를 정상적으로 사용하고 브라우저에서 `http://localhost:7008`을 열어 모니터링 인터페이스를 확인하세요.

Claude Code 업데이트 후 수동 작업이 필요 없습니다. 다음에 `claude`를 실행하면 자동으로 감지하고 재설정합니다.

### 제거

```bash
ccv --uninstall
```

## 기능

### 요청 모니터링 (원문 모드)

- Claude Code에서 발생하는 모든 API 요청을 실시간 캡처 (스트리밍 응답 포함)
- 왼쪽 패널에 요청 방법, URL, 소요 시간, 상태 코드 표시
- Main Agent 및 Sub Agent 요청 자동 식별 및 라벨링 (하위 유형: Bash, Task, Plan, General)
- 오른쪽 패널에서 Request / Response 탭 전환 지원
- Request Body의 `messages`, `system`, `tools` 기본 1단계 펼침
- Response Body 기본 전체 펼침
- JSON 뷰와 일반 텍스트 뷰 전환 지원
- JSON 내용 원클릭 복사
- MainAgent 요청에 Body Diff JSON 지원, 이전 MainAgent 요청과의 차이를 접어서 표시 (변경/추가된 필드만 표시)
- Body Diff JSON 툴팁은 닫기 가능하며, 닫으면 서버 측에 환경설정이 저장되어 다시 표시되지 않습니다

### 대화 모드

오른쪽 상단의 "대화 모드" 버튼을 클릭하여 Main Agent의 전체 대화 기록을 채팅 인터페이스로 파싱:

- 사용자 메시지 오른쪽 정렬 (파란색 말풍선), Main Agent 응답 왼쪽 정렬 (어두운 말풍선), Markdown 렌더링 지원
- `/compact` 메시지 자동 감지 및 접힌 상태로 표시, 클릭하여 전체 요약 펼치기
- 도구 호출 결과가 해당 Assistant 메시지 내부에 인라인 표시
- `thinking` 블록 기본 접힘, 클릭하여 사고 과정 확인
- `tool_use`가 컴팩트한 도구 호출 카드로 표시 (Bash, Read, Edit, Write, Glob, Grep, Task 등 전용 표시)
- 사용자 선택 메시지 (AskUserQuestion) Q&A 형식으로 표시
- 시스템 태그 (`<system-reminder>`, `<project-reminder>` 등) 자동 접힘
- 시스템 텍스트 자동 필터링, 실제 사용자 입력만 표시
- 다중 session 분할 표시 (`/compact`, `/clear` 등 작업 후 자동 분할)
- 각 메시지에 초 단위 정확한 타임스탬프 표시

### Token 소비 통계

헤더 영역의 호버 패널:

- 모델별 input/output token 수량 그룹 통계
- Cache creation/read 수량 및 캐시 적중률 표시
- Main Agent 캐시 만료 카운트다운

### 로그 관리

왼쪽 상단 CC-Viewer 드롭다운 메뉴:

- 로컬 로그 가져오기: 프로젝트별 그룹화된 기록 로그 파일 탐색, 새 창에서 열기
- 로컬 JSONL 파일 불러오기: 로컬 `.jsonl` 파일을 직접 선택하여 불러오기 (최대 200MB)
- 현재 로그 다운로드: 현재 모니터링 중인 JSONL 로그 파일 다운로드
- 사용자 Prompt 내보내기: 모든 사용자 입력 추출 및 표시, system-reminder 접기 지원
- Prompt를 TXT로 내보내기: 사용자 Prompt를 로컬 `.txt` 파일로 내보내기

### 다국어 지원

CC-Viewer는 18개 언어를 지원하며, 시스템 로케일에 따라 자동 전환됩니다:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
