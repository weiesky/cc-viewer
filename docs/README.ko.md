# CC-Viewer

Claude Code 요청 모니터링 시스템으로, Claude Code의 모든 API 요청과 응답을 실시간으로 캡처하고 시각화합니다(원본 텍스트, 무삭제). 개발자가 자신의 Context를 모니터링하여 Vibe Coding 과정에서 문제를 검토하고 추적하는 데 유용합니다.
최신 버전의 CC-Viewer는 서버 배포 웹 프로그래밍 솔루션과 모바일 프로그래밍 도구도 제공합니다. 여러분의 프로젝트에서 활용해 보세요. 앞으로 더 많은 플러그인 기능과 클라우드 배포를 지원할 예정입니다.

먼저 재미있는 부분을 확인하세요. 모바일에서 이런 것을 볼 수 있습니다:

<img width="1700" height="790" alt="image" src="https://github.com/user-attachments/assets/da3e519f-ff66-4cd2-81d1-f4e131215f6c" />

[English](../README.md) | [简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | 한국어 | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## 사용 방법

### 설치

```bash
npm install -g cc-viewer --registry=https://registry.npmjs.org
```

### 프로그래밍 모드

ccv는 claude의 드롭인 대체품으로, 모든 인수가 claude에 그대로 전달되며 동시에 Web Viewer가 실행됩니다.

```bash
ccv                    # == claude (대화형 모드)
ccv -c                 # == claude --continue (이전 대화 이어가기)
ccv -r                 # == claude --resume (대화 복원)
ccv -p "hello"         # == claude --print "hello" (출력 모드)
ccv --d                # == claude --dangerously-skip-permissions (단축키)
ccv --model opus       # == claude --model opus
```

저자가 자주 사용하는 명령어는 다음과 같습니다:
```
ccv -c --d             # == claude --continue --dangerously-skip-permissions
```

프로그래밍 모드로 실행하면 웹 페이지가 자동으로 열립니다.

웹 페이지에서 Claude를 직접 사용하면서 전체 요청 페이로드와 코드 변경 사항을 확인할 수 있습니다.

더 멋진 것은, 모바일 기기에서도 코딩할 수 있다는 점입니다!


### 로거 모드

⚠️ 여전히 claude 네이티브 도구나 VS Code 확장을 사용하고 싶다면 이 모드를 사용하세요.

이 모드에서 ```claude``` 또는 ```claude --dangerously-skip-permissions```를 실행하면

자동으로 로깅 프로세스가 시작되어 요청 로그를 ~/.claude/cc-viewer/*yourproject*/date.jsonl에 기록합니다.

로거 모드 활성화:
```bash
ccv -logger
```

콘솔에서 특정 포트를 출력할 수 없는 경우, 기본 첫 번째 포트는 127.0.0.1:7008입니다. 여러 인스턴스가 있으면 7009, 7010 등 순차적으로 할당됩니다.

이 명령어는 로컬에 설치된 Claude Code의 방식(NPM 또는 Native Install)을 자동으로 감지하고 적절히 적용합니다.

- **NPM 버전 Claude Code**: Claude Code의 `cli.js`에 인터셉터 스크립트를 자동으로 주입합니다.
- **Native 버전 Claude Code**: `claude` 바이너리를 자동으로 감지하고, 로컬 투명 프록시를 구성하며, Zsh Shell Hook을 설정하여 트래픽을 자동으로 전달합니다.
- 본 프로젝트에서는 npm으로 설치된 Claude Code를 권장합니다.

로거 모드 제거:
```bash
ccv --uninstall
```

### 문제 해결 (Troubleshooting)

실행이 안 되는 문제가 발생하면, 궁극적인 해결 방법이 있습니다:
1단계: 아무 디렉토리에서 Claude Code를 실행합니다.
2단계: Claude Code에 다음 지시를 내립니다:
```
cc-viewer npm 패키지를 설치했지만 ccv를 실행한 후에도 제대로 작동하지 않습니다. cc-viewer의 cli.js와 findcc.js를 확인하고, 현재 환경에 맞게 로컬 Claude Code 배포 방식에 적합하도록 수정해 주세요. 수정 범위는 가능한 findcc.js 내로 제한해 주세요.
```
Claude Code가 직접 오류를 진단하는 것이 누구에게 물어보거나 어떤 문서를 읽는 것보다 효과적입니다!

위 지시가 완료되면 findcc.js가 업데이트됩니다. 프로젝트에서 로컬 배포가 자주 필요하거나, fork한 코드에서 설치 문제를 자주 해결해야 한다면 이 파일을 보관해 두면 다음에 바로 복사할 수 있습니다. 현재 많은 프로젝트와 기업이 Claude Code를 Mac이 아닌 서버 측 호스팅 환경에서 배포하고 있으므로, 저자는 findcc.js를 분리하여 cc-viewer 소스 코드 업데이트를 더 쉽게 추적할 수 있도록 했습니다.

### 기타 보조 명령어

참조:
```bash
ccv -h
```

### 설정 오버라이드 (Configuration Override)

커스텀 API 엔드포인트(예: 기업 프록시)를 사용해야 하는 경우, `~/.claude/settings.json`에서 설정하거나 `ANTHROPIC_BASE_URL` 환경 변수를 설정하기만 하면 됩니다. `ccv`가 자동으로 인식하여 올바르게 요청을 전달합니다.

### 사일런트 모드 (Silent Mode)

기본적으로 `ccv`는 `claude`를 래핑하여 실행할 때 사일런트 모드로 동작하여, 터미널 출력을 깔끔하게 유지하며 네이티브 경험과 일치시킵니다. 모든 로그는 백그라운드에서 캡처되며 `http://localhost:7008`에서 확인할 수 있습니다.

설정 완료 후, `claude` 명령어를 평소처럼 사용하면 됩니다. `http://localhost:7008`에 접속하여 모니터링 인터페이스를 확인하세요.


## 클라이언트 버전

cc-viewer는 클라이언트 버전을 제공하며, GitHub에서 해당 클라이언트 버전을 다운로드할 수 있습니다.
[다운로드 링크](https://github.com/weiesky/cc-viewer/releases)
현재 클라이언트 버전은 테스트 단계에 있으며, 문제가 있으면 언제든지 피드백을 보내주세요. 또한 cc-viewer를 사용하려면 로컬에 Claude Code가 설치되어 있어야 합니다.
주의할 점은, cc-viewer는 항상 작업자(Claude Code)의 "옷"에 불과하다는 것입니다. Claude Code가 없으면 옷만으로는 독립적으로 작동할 수 없습니다.

## 기능


### 프로그래밍 모드

ccv로 실행한 후 볼 수 있는 화면:

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/ab353a2b-f101-409d-a28c-6a4e41571ea2" />


편집 완료 후 코드 diff를 바로 확인할 수 있습니다:

<img width="1500" height="728" alt="image" src="https://github.com/user-attachments/assets/2a4acdaa-fc5f-4dc0-9e5f-f3273f0849b2" />

파일을 열어 수동으로 코딩할 수도 있지만, 수동 코딩은 권장하지 않습니다. 그것은 구식 코딩입니다!

### 모바일 프로그래밍

QR 코드를 스캔하여 모바일 기기에서 코딩할 수도 있습니다:

<img width="3018" height="1460" alt="image" src="https://github.com/user-attachments/assets/8debf48e-daec-420c-b37a-609f8b81cd20" />

모바일 프로그래밍에 대한 상상을 현실로 만들어 줍니다. 또한 플러그인 메커니즘이 있어서, 자신의 코딩 습관에 맞게 커스터마이징이 필요하다면 플러그인 hooks 업데이트를 기대해 주세요.

### 로거 모드 (Claude Code 전체 세션 보기)

<img width="1500" height="768" alt="image" src="https://github.com/user-attachments/assets/a8a9f3f7-d876-4f6b-a64d-f323a05c4d21" />


- Claude Code가 보내는 모든 API 요청을 실시간으로 캡처하며, 삭제되지 않은 원본 텍스트를 보장합니다 (이것이 매우 중요합니다!!!)
- Main Agent와 Sub Agent 요청을 자동으로 식별하고 레이블링합니다 (하위 유형: Plan, Search, Bash)
- MainAgent 요청에서 Body Diff JSON을 지원하여, 이전 MainAgent 요청과의 차이를 접어서 표시합니다 (변경/추가된 필드만 표시)
- 각 요청에 Token 사용량 통계를 인라인으로 표시합니다 (입력/출력 Token, 캐시 생성/읽기, 적중률)
- Claude Code Router (CCR) 및 기타 프록시 시나리오와 호환됩니다 — API 경로 패턴 매칭으로 폴백

### 대화 모드

우측 상단의 "대화 모드" 버튼을 클릭하면 Main Agent의 전체 대화 기록을 채팅 인터페이스로 파싱합니다:

<img width="1500" height="764" alt="image" src="https://github.com/user-attachments/assets/725b57c8-6128-4225-b157-7dba2738b1c6" />


- Agent Team 표시는 아직 지원되지 않습니다
- 사용자 메시지는 오른쪽 정렬(파란색 말풍선), Main Agent 응답은 왼쪽 정렬(어두운 말풍선)
- `thinking` 블록은 기본적으로 접혀 있으며 Markdown으로 렌더링됩니다. 클릭하면 사고 과정을 확인할 수 있습니다. 원클릭 번역을 지원합니다(기능이 아직 불안정합니다)
- 사용자 선택형 메시지(AskUserQuestion)는 Q&A 형식으로 표시됩니다
- 양방향 모드 동기화: 대화 모드로 전환 시 선택한 요청에 해당하는 대화로 자동 이동, 원본 모드로 전환 시 선택한 요청으로 자동 이동
- 설정 패널: 도구 결과와 사고 블록의 기본 접힘 상태를 전환할 수 있습니다
- 모바일 대화 탐색: 모바일 CLI 모드에서 상단 바의 "대화 탐색" 버튼을 탭하면 읽기 전용 대화 뷰가 슬라이드되어 모바일에서 전체 대화 기록을 탐색할 수 있습니다

### 통계 도구

헤더 영역의 "데이터 통계" 플로팅 패널:

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/a3d2db47-eac3-463a-9b44-3fa64994bf3b" />

- cache creation/read 수량 및 캐시 적중률 표시
- 캐시 재구축 통계: 원인별 그룹화(TTL, system/tools/model 변경, 메시지 잘림/수정, key 변경)로 횟수와 cache_creation tokens 표시
- 도구 사용 통계: 호출 횟수 순으로 각 도구의 호출 빈도 표시
- Skill 사용 통계: 호출 횟수 순으로 각 Skill의 호출 빈도 표시
- teammate 통계 지원
- 개념 도움말 (?) 아이콘: 클릭하면 MainAgent, CacheRebuild 및 각 도구의 내장 문서를 확인할 수 있습니다

### 로그 관리

좌측 상단 CC-Viewer 드롭다운 메뉴를 통해:
<img width="1500" height="760" alt="image" src="https://github.com/user-attachments/assets/33295e2b-f2e0-4968-a6f1-6f3d1404454e" />

**로그 압축**
로그에 관해 저자는 Anthropic의 공식 정의를 수정하지 않았음을 보증하여 로그의 완전성을 확보합니다.
다만 1M Opus 모델의 후반부에 생성되는 단일 로그 항목이 매우 커지기 때문에, 저자가 MainAgent에 대한 일부 로그 최적화를 적용하여 gzip 없이도 최소 66%의 용량 절감을 달성했습니다.
이 압축 로그의 파싱 방법은 현재 저장소에서 추출할 수 있습니다.

### 더 많은 편리하고 유용한 기능

<img width="1500" height="767" alt="image" src="https://github.com/user-attachments/assets/add558c5-9c4d-468a-ac6f-d8d64759fdbd" />

사이드바 도구를 통해 프롬프트를 빠르게 찾을 수 있습니다.

--- 

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/82b8eb67-82f5-41b1-89d6-341c95a047ed" />

흥미로운 KV-Cache-Text 기능으로 Claude가 보는 것을 정확히 볼 수 있습니다.

---

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/54cdfa4e-677c-4aed-a5bb-5fd946600c46" />

이미지를 업로드하고 요구사항을 설명할 수 있습니다. Claude의 이미지 이해 능력은 매우 강력합니다. 또한 아시다시피 Ctrl+V로 스크린샷을 직접 붙여넣을 수 있으며, 대화에서 전체 내용이 표시됩니다.

---

<img width="600" height="370" alt="image" src="https://github.com/user-attachments/assets/87d332ea-3e34-4957-b442-f9d070211fbf" />

플러그인을 직접 커스터마이징하고, CC-Viewer의 모든 프로세스를 관리할 수 있으며, CC-Viewer는 서드파티 API로의 핫 스위칭을 지원합니다(맞습니다, GLM, Kimi, MiniMax, Qwen, DeepSeek을 사용할 수 있습니다. 저자는 현재 이들 모두 상당히 약하다고 생각하지만요).

---


<img width="1500" height="746" alt="image" src="https://github.com/user-attachments/assets/b1f60c7c-1438-4ecc-8c64-193d21ee3445" />

더 많은 기능이 여러분을 기다리고 있습니다... 예를 들어: 본 시스템은 Agent Team을 지원하며, Code Reviewer가 내장되어 있습니다. Codex의 Code Reviewer 통합이 곧 제공될 예정입니다(저자는 Codex를 사용하여 Claude Code의 코드를 리뷰하는 것을 매우 추천합니다).


### 자동 업데이트

CC-Viewer는 시작 시 자동으로 업데이트를 확인합니다(최대 4시간마다 한 번). 같은 메이저 버전 내(예: 1.x.x -> 1.y.z)에서는 자동으로 업데이트되며 다음 재시작 시 적용됩니다. 메이저 버전이 다른 업데이트는 알림만 표시됩니다.

자동 업데이트는 Claude Code의 글로벌 설정 `~/.claude/settings.json`을 따릅니다. Claude Code에서 자동 업데이트를 비활성화한 경우(`autoUpdates: false`), CC-Viewer도 자동 업데이트를 건너뜁니다.

### 다국어 지원

CC-Viewer는 18개 언어를 지원하며 시스템 로케일에 따라 자동으로 전환됩니다:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
