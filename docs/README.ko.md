# CC-Viewer

Claude Code 요청 모니터링 시스템으로, Claude Code의 모든 API 요청과 응답을 실시간으로 캡처하고 시각화합니다(원본 텍스트, 삭제 없음). 개발자가 Vibe Coding 과정에서 자신의 Context를 모니터링하고 문제를 검토 및 추적하는 데 도움을 줍니다.

[English](../README.md) | [简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | 한국어 | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## 사용법

### 설치

```bash
npm install -g cc-viewer
```

### 실행 및 자동 구성

```bash
ccv
```

이 명령은 로컬 Claude Code의 설치 방식(NPM 또는 Native Install)을 자동으로 감지하고 적응합니다.

- **NPM 설치**: Claude Code의 `cli.js`에 인터셉터 스크립트를 자동으로 주입합니다.
- **Native Install**: `claude` 바이너리를 자동으로 감지하고, 로컬 투명 프록시를 구성하며, Zsh Shell Hook을 설정하여 트래픽을 자동으로 전달합니다.

### 구성 재정의 (Configuration Override)

사용자 지정 API 엔드포인트(예: 기업 프록시)를 사용해야 하는 경우, `~/.claude/settings.json`에서 구성하거나 `ANTHROPIC_BASE_URL` 환경 변수를 설정하기만 하면 됩니다. `ccv`는 자동으로 이를 인식하고 요청을 올바르게 전달합니다.

### 사일런트 모드 (Silent Mode)

기본적으로 `ccv`는 `claude`를 래핑하여 실행할 때 사일런트 모드로 작동하여 터미널 출력을 깔끔하게 유지하고 네이티브 경험과 동일하게 합니다. 모든 로그는 백그라운드에서 캡처되며 `http://localhost:7008`에서 확인할 수 있습니다.

구성이 완료되면 평소처럼 `claude` 명령을 사용하면 됩니다. `http://localhost:7008`을 방문하여 모니터링 인터페이스를 확인하세요.

### 문제 해결 (Troubleshooting)

- **혼합 출력 (Mixed Output)**: `[CC-Viewer]` 디버그 로그가 Claude 출력과 섞여 보이는 경우 최신 버전으로 업데이트하세요 (`npm install -g cc-viewer`).
- **연결 거부 (Connection Refused)**: `ccv` 백그라운드 프로세스가 실행 중인지 확인하세요. `ccv` 또는 `claude`(Hook 설치 후)를 실행하면 자동으로 시작됩니다.
- **본문 없음 (Empty Body)**: Viewer에서 "No Body"가 표시되면 비표준 SSE 형식 때문일 수 있습니다. Viewer는 이제 폴백으로 원시 콘텐츠 캡처를 지원합니다.

### 제거

```bash
ccv --uninstall
```

### 버전 확인

```bash
ccv --version
```

## 기능

### 요청 모니터링 (원문 모드)
<img width="1500" height="720" alt="image" src="https://github.com/user-attachments/assets/519dd496-68bd-4e76-84d7-2a3d14ae3f61" />
- Claude Code에서 발생하는 모든 API 요청을 실시간으로 캡처하며, 삭제된 로그가 아닌 원문을 보장합니다 (이것은 매우 중요합니다!!!)
- Main Agent 및 Sub Agent 요청을 자동으로 식별하고 라벨링 (하위 유형: Bash, Task, Plan, General)
- MainAgent 요청은 Body Diff JSON을 지원하며, 이전 MainAgent 요청과의 차이를 접어서 표시 (변경/추가된 필드만 표시)
- 각 요청에 인라인으로 Token 사용량 통계 표시 (입력/출력 Token, 캐시 생성/읽기, 적중률)
- Claude Code Router(CCR) 및 기타 프록시 환경과 호환 — API 경로 패턴을 통한 폴백 매칭

### 대화 모드

오른쪽 상단의 "대화 모드" 버튼을 클릭하여 Main Agent의 전체 대화 기록을 채팅 인터페이스로 파싱:
<img width="1500" height="730" alt="image" src="https://github.com/user-attachments/assets/c973f142-748b-403f-b2b7-31a5d81e33e6" />


- Agent Team 표시는 아직 지원되지 않습니다
- 사용자 메시지는 오른쪽 정렬 (파란색 말풍선), Main Agent 응답은 왼쪽 정렬 (어두운 말풍선)
- `thinking` 블록은 기본적으로 접혀 있으며, Markdown으로 렌더링되고, 클릭하여 사고 과정을 확인할 수 있습니다; 원클릭 번역 지원 (기능이 아직 불안정)
- 사용자 선택 메시지 (AskUserQuestion)는 Q&A 형식으로 표시
- 양방향 모드 동기화: 대화 모드로 전환 시 선택된 요청에 해당하는 대화로 자동 이동; 원문 모드로 전환 시 선택된 요청으로 자동 이동
- 설정 패널: 도구 결과 및 사고 블록의 기본 접힘 상태 전환 가능


### 통계 도구

Header 영역의 "데이터 통계" 호버 패널:
<img width="1500" height="729" alt="image" src="https://github.com/user-attachments/assets/b23f9a81-fc3d-4937-9700-e70d84e4e5ce" />

- cache creation/read 수량 및 캐시 적중률 표시
- 캐시 재구축 통계: 원인별 그룹화 (TTL, system/tools/model 변경, 메시지 잘림/수정, key 변경) 횟수 및 cache_creation tokens 표시
- 도구 사용 통계: 호출 횟수 기준으로 각 도구의 호출 빈도 표시
- Skill 사용 통계: 호출 횟수 기준으로 각 Skill의 호출 빈도 표시
- 개념 도움말 (?) 아이콘: 클릭하면 MainAgent, CacheRebuild 및 각 도구의 내장 문서를 볼 수 있음

### 로그 관리

왼쪽 상단 CC-Viewer 드롭다운 메뉴:
<img width="1200" height="672" alt="image" src="https://github.com/user-attachments/assets/8cf24f5b-9450-4790-b781-0cd074cd3b39" />

- 로컬 로그 가져오기: 프로젝트별로 그룹화된 기록 로그 파일 탐색, 새 창에서 열기
- 로컬 JSONL 파일 불러오기: 로컬 `.jsonl` 파일을 직접 선택하여 불러오기 (최대 500MB 지원)
- 현재 로그 다른 이름으로 저장: 현재 모니터링 중인 JSONL 로그 파일 다운로드
- 로그 병합: 여러 JSONL 로그 파일을 하나의 세션으로 병합하여 통합 분석
- 사용자 Prompt 보기: 모든 사용자 입력을 추출하여 세 가지 보기 모드로 표시 — 원문 모드(원본 내용), 컨텍스트 모드(시스템 태그 접기 가능), Text 모드(순수 텍스트); 슬래시 명령(`/model`, `/context` 등)은 독립 항목으로 표시; 명령 관련 태그는 Prompt 내용에서 자동 숨김
- Prompt를 TXT로 내보내기: 사용자 Prompt(순수 텍스트, 시스템 태그 제외)를 로컬 `.txt` 파일로 내보내기

### 다국어 지원

CC-Viewer는 18개 언어를 지원하며, 시스템 로케일에 따라 자동 전환됩니다:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
