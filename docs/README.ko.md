# CC-Viewer

🌐 **웹사이트 및 기능 둘러보기: [weiesky.github.io/cc-viewer](https://weiesky.github.io/cc-viewer/)** — 18개 언어 지원.


Claude Code를 기반으로, 자신의 개발 경험을 증류하여 축적한 Vibe Coding 도구입니다:

1. 능력의 상한을 끌어올립니다. /ultraPlan, /ultraReview를 로컬에서 실행할 수 있어 프로젝트 코드를 Claude 클라우드에 완전히 노출시키지 않아도 됩니다;
2. 멀티 디바이스 동시 지원. 로컬 네트워크 내에서 모바일 프로그래밍이 가능하며, 웹 버전은 다양한 시나리오에 자동 적응하여 브라우저 확장 프로그램이나 OS 분할 화면에 손쉽게 임베딩할 수 있고, 네이티브 설치 프로그램도 제공합니다;
3. 완전한 로그 추적. Claude Code 페이로드를 완전히 가로채고 분석하는 기능을 제공하여 로깅, 문제 분석, 학습, 리버스 엔지니어링에 최적입니다;
4. 학습 경험 공유. 풍부한 학습 자료와 개발 경험을 축적해 두었습니다(시스템 곳곳의 "?" 아이콘을 참고하세요);
5. 네이티브 경험 유지. Claude Code의 능력을 강화할 뿐, 코어에는 어떠한 실질적인 수정도 가하지 않아 네이티브 경험을 유지합니다;
6. 서드파티 모델 지원. deepseek-v4-\*, GLM 5.1, Kimi K2.6을 지원하며, cc-switch 기능을 내장하여 언제든지 서드파티 도구로 핫 스위칭할 수 있습니다;

<img width="860" alt="cc-viewer — deploy once, share with every device" src="https://raw.githubusercontent.com/weiesky/cc-viewer/main/docs/cc-viewer-share.svg" />

[English](../README.md) | [简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | 한국어 | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## 사용 방법

### 전제 조건

* nodejs 20.0.0+ 가 설치되어 있는지 확인하세요; [다운로드 및 설치](https://nodejs.org)
* claude code 가 설치되어 있는지 확인하세요; [설치 가이드](https://github.com/anthropics/claude-code)

### ccv 설치

#### npm 으로 설치

```bash
npm install -g cc-viewer --registry=https://registry.npmjs.org
```

#### Homebrew 로 설치 (macOS / Linux 권장)

```bash
brew tap weiesky/cc-viewer
brew install cc-viewer
brew upgrade cc-viewer   # 업그레이드는 이 명령으로 — brew 로 설치한 ccv 를 npm install -g 로 업그레이드하지 마세요
```

### 시작 방법

ccv 는 claude 의 드롭인 대체이며, 모든 인자를 claude 에 그대로 전달하면서 동시에 Web Viewer 를 실행합니다.

```bash
ccv                    # == claude (대화형 모드)
```

제가 가장 자주 사용하는 명령은 다음과 같습니다:

```
ccv -c --d             # == claude --continue --dangerously-skip-permissions
                       # ccv 는 Claude Code 의 모든 시작 인자를 그대로 전달합니다 — 원하는 대로 자유롭게 조합할 수 있습니다
```

프로그래밍 모드로 실행되면 웹 페이지가 자동으로 열립니다.

cc-viewer 는 네이티브 데스크톱 앱도 제공합니다: [다운로드 페이지](https://github.com/weiesky/cc-viewer/releases)

### 1.7.0 으로 업그레이드 (로그 형식 v2)

1.7.0 부터 로그는 단일 `.jsonl` 파일 대신 세션별 디렉터리 형식(wire-format v2)으로 저장되며, 디스크 사용량이 약 90% 줄어듭니다. 기존 v1 `.jsonl` 파일은 절대 수정되거나 삭제되지 않으며, 로그 대화상자는 기본적으로 v2 세션을 표시하며, 작은 “레거시(v1) 로그 보기” 항목(오래된 파일이 있는 동안 표시됨)에서 v1 보기를 열어 확인, 마이그레이션 또는 삭제할 수 있습니다. 시작 시 레거시 로그가 발견되면 cc-viewer 가 원클릭 마이그레이션을 제공합니다(`claude -c` 로 이전 대화를 이어갈 때는 대화의 전반부가 이전 파일에 저장되어 있으므로 마이그레이션을 강력히 권장합니다). 터미널에서 마이그레이션할 수도 있습니다:

```bash
ccv convert <project>   # 프로젝트 하나 마이그레이션
ccv convert --all       # 모든 프로젝트 마이그레이션
ccv verify <v1-file>    # v1 파일을 변환된 세션과 대조하여 확인
```

세션이 golden 검증을 통과하지 못하면 전체 마이그레이션을 실패시키는 대신 `sessions-quarantine/`에 보관되어 검토할 수 있습니다. 나머지 세션은 정상적으로 마이그레이션됩니다.

### 로거 모드

여전히 네이티브 claude 도구나 VS Code 확장을 사용하고 싶다면 이 모드를 사용하세요.

이 모드에서 `claude` 를 실행하면 로깅 프로세스가 자동으로 시작되어 요청 로그를 \~/.claude/cc-viewer/*yourproject*/sessions/ 아래의 세션별 디렉터리(wire-format v2)에 기록합니다.

로거 모드 활성화:

```bash
ccv -logger
```

콘솔에서 구체적인 포트를 출력하지 못하는 경우, 기본 첫 번째 포트는 127.0.0.1:7008 입니다. 여러 인스턴스가 존재할 때는 7009, 7010 처럼 순차적으로 포트가 증가합니다.

로거 모드 제거:

```bash
ccv --uninstall
```

### 문제 해결 (Troubleshooting)

실행에 문제가 발생한 경우, 궁극의 해결 방법이 있습니다:
1단계: 임의의 디렉터리에서 Claude Code 를 엽니다;
2단계: Claude Code 에 다음 지시를 내립니다:

```
저는 cc-viewer 라는 npm 패키지를 설치했지만, ccv 를 실행해도 여전히 정상적으로 작동하지 않습니다. cc-viewer 의 cli.js 와 findcc.js 를 살펴보고, 현재 환경에 맞춰 로컬 Claude Code 의 배포 방식에 적응시켜 주세요. 가능한 한 수정 범위는 findcc.js 에 한정해 주세요.
```

Claude Code 가 직접 문제를 진단하게 하는 것이 누군가에게 묻거나 어떤 문서를 읽는 것보다 훨씬 효과적입니다!

위 지시가 완료되면 findcc.js 가 업데이트됩니다. 프로젝트가 로컬 배포를 자주 필요로 하거나, 포크한 코드가 종종 설치 문제를 해결해야 한다면 이 파일을 보관해 두면 됩니다. 다음에는 그대로 복사만 하면 됩니다. 현 단계에서는 Claude Code 를 사용하는 많은 프로젝트와 회사들이 Mac 이 아닌 서버 측 호스팅 배포를 사용하기 때문에, 저는 cc-viewer 소스 코드 업데이트 추적을 용이하게 하기 위해 findcc.js 를 분리했습니다.

주의: 이 앱은 claude-code-switch, claude-code-router 와 충돌합니다. 프록시 경합 문제가 있으니 사용 시에는 반드시 claude-code-switch, claude-code-router 를 비활성화하세요. cc-viewer 내부에 프록시 핫 업데이트 기능이 제공되어 그것들을 대체할 수 있습니다.

### 기타 보조 명령

참조:

```bash
ccv -h
```

### 사일런트 모드 (Silent Mode)

기본적으로 `ccv` 는 `claude` 를 래핑할 때 사일런트 모드로 실행되어 터미널 출력이 깔끔하게 유지되며 네이티브 경험과 일관성을 가집니다. 모든 로그는 백그라운드에서 캡처되며 `http://localhost:7008` 에서 확인할 수 있습니다.

설정이 완료되면 평소처럼 `claude` 명령을 사용하면 됩니다. `http://localhost:7008` 에 접속하여 모니터링 UI 를 열어보세요.

## 기능

### 프로그래밍 모드

ccv 로 시작하면 다음을 확인할 수 있습니다:

<img height="765" width="1500" alt="image" src="https://github.com/user-attachments/assets/ab353a2b-f101-409d-a28c-6a4e41571ea2" />

편집이 끝난 후 즉시 코드 diff 를 확인할 수 있습니다:

<img height="728" width="1500" alt="image" src="https://github.com/user-attachments/assets/2a4acdaa-fc5f-4dc0-9e5f-f3273f0849b2" />

파일을 열어 수동으로 코딩할 수 있지만 권장하지 않습니다 — 그것은 구식 코딩입니다!

### 모바일 프로그래밍

QR 코드를 스캔하여 모바일 디바이스에서도 코딩할 수 있습니다:

<img height="1460" width="3018" alt="image" src="https://github.com/user-attachments/assets/8debf48e-daec-420c-b37a-609f8b81cd20" />

<img height="790" width="1700" alt="image" src="https://github.com/user-attachments/assets/da3e519f-ff66-4cd2-81d1-f4e131215f6c" />

모바일 프로그래밍에 대한 상상을 충족시켜 줍니다. 또한 플러그인 메커니즘도 있어, 자신의 코딩 습관에 맞춰 커스터마이즈가 필요하다면 이후의 플러그인 hook 업데이트를 기대해 주세요.

### 모델별 시스템 프롬프트

**시스템 프롬프트 편집** 모달(햄버거 메뉴 → 시스템 프롬프트 편집)은 탭 방식으로 구성되어 있습니다:

* **기본** 탭은 기존 동작을 유지합니다: 현재 워크스페이스에 `CC_SYSTEM.md`(덮어쓰기) 또는 `CC_APPEND_SYSTEM.md`(추가)를 기록하며, 다음 ccv 실행 시 `--system-prompt-file` / `--append-system-prompt-file` 로 주입됩니다.
* **모델 탭**: **+ 모델 추가**를 클릭하고 `opus` 나 `Gemini3` 같은 이름을 입력한 뒤 범위를 선택하세요 — **전역**(`~/.claude/cc-viewer/system_prompt/`, 모든 워크스페이스에 적용) 또는 **워크스페이스**(`<project>/system_prompt/`). 이름 입력란은 로컬에 구성된 모델(핫 리로드 프록시 프로필 및 `settings.json`)을 기반으로 입력 제안을 제공합니다. 선택한 범위에 이미 추가된 이름은 제안에서 숨겨지며, 임의의 이름을 자유롭게 입력할 수도 있습니다. 각 탭에는 자체 추가/덮어쓰기 스위치와 Markdown 미리보기가 있습니다.
* 항목은 대문자 파일로 저장됩니다: `OPUS_SYSTEM.md`(덮어쓰기) 또는 `OPUS_APPEND_SYSTEM.md`(추가). 매칭은 퍼지 방식으로, 「현재 적용 중인 설정」에서 해석된 모델 ID(활성화된 서드파티 proxy profile의 모델 매핑 > 시작 시 환경 변수 `ANTHROPIC_MODEL`/`CLAUDE_MODEL` > `settings.json`의 `model`; 설정 신호가 없으면 항목이 주입되지 않음)에 대해 대소문자를 구분하지 않는 부분 문자열로 매칭하므로 `opus` 는 버전과 관계없이 `claude-opus-4-8[1m]` 에 매칭됩니다. 워크스페이스 매칭이 전역 매칭보다 우선하며, 같은 범위 안에서는 가장 긴 이름이 이깁니다. 매칭된 항목은 해당 실행에서 기본 탭의 파일을 완전히 대체합니다. 알려진 제한: 세션 도중 proxy profile을 전환하면 claude 세션을 재시작해야 다시 매칭됩니다; 추가 인자로 전달한 `--model`은 해석에 사용되지 않습니다.
* 탭을 비운 채 저장하면 해당 항목이 삭제됩니다. 세션 도중의 모델 전환은 다음 재실행 시 적용됩니다. `CCV_DISABLE_AUTO_SYSTEM_PROMPT=1` 을 설정하면 모든 자동 주입을 비활성화할 수 있습니다. `<project>/system_prompt/` 를 커밋하여 팀과 프롬프트를 공유하거나, `.gitignore` 에 추가하여 비공개로 유지할 수 있습니다.

### 로거 모드 (Claude Code 의 완전한 세션 보기)

<img width="860" alt="cc-viewer — wire-level capture and packet decomposition" src="https://raw.githubusercontent.com/weiesky/cc-viewer/main/docs/cc-viewer-proxy.svg" />

* Claude Code 가 보내는 모든 API 요청을 실시간으로 캡처하며, 편집되지 않은 원문 그대로임을 보장합니다(이것은 매우 중요합니다!!!)
* Main Agent 와 Sub Agent 요청을 자동으로 식별하고 라벨링합니다(서브타입: Plan, Search, Bash)
* MainAgent 요청은 Body Diff JSON 을 지원하여, 직전 MainAgent 요청과의 차이(변경/추가된 필드만)를 접힌 상태로 표시합니다
* 각 요청에는 Token 사용 통계가 인라인으로 표시됩니다(입력/출력 Token, 캐시 생성/읽기, 적중률)
* Claude Code Router (CCR) 및 기타 프록시 시나리오와 호환됩니다 — API 경로 패턴 매칭으로 fallback 처리합니다

<a href="https://www.star-history.com/?repos=weiesky%2Fcc-viewer&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=weiesky/cc-viewer&type=date&theme=dark&legend=top-left" />

    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=weiesky/cc-viewer&type=date&legend=top-left" />

    ![Star History Chart](https://api.star-history.com/chart?repos=weiesky/cc-viewer&type=date&legend=top-left)
  </picture>
</a>

## License

MIT
