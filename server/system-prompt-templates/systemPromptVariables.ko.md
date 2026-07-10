# systemPromptModel.md 변수

이 파일은 `systemPromptModel.md`에서 런타임에 해결해야 하는 변수만 문서화합니다. 모든 리프 변수는 문자열, 숫자 또는 빈 문자열 `""`로 해결되며, 값을 얻을 수 없을 때 일반적으로 빈 문자열로 대체됩니다.

## 작업 공간 및 사용자 환경

| Variable | Description | Example |
|---|---|---|
| `${environment.cwd}` | 현재 주 작업 디렉토리입니다. | `/Users/sky/claude-code` |
| `${environment.originalCwd}` | 프로세스/세션이 시작된 시점의 원본 작업 디렉토리입니다. | `/Users/sky/claude-code` |
| `${environment.home}` | 사용자 홈 디렉토리로 `~`을 해결하는 데 사용됩니다. | `/Users/sky` |
| `${environment.user}` | 현재 시스템 사용자 이름입니다. | `sky` |
| `${environment.workspaceRoots}` | 현재 세션의 작업 공간 루트입니다. 줄 바꿈으로 구분된 문자열로 렌더링될 수 있습니다. | `/Users/sky/claude-code` |
| `${environment.path}` | 현재 프로세스 PATH입니다. | `/opt/homebrew/bin:/usr/bin:/bin` |
| `${environment.lang}` | 현재 로컬 또는 언어 환경입니다. | `zh_CN.UTF-8` |

## 운영 체제

| Variable | Description | Example |
|---|---|---|
| `${os.platform}` | Node.js에서 식별한 플랫폼입니다. | `darwin` |
| `${os.type}` | 운영 체제 유형입니다. | `Darwin` |
| `${os.arch}` | CPU 아키텍처입니다. | `arm64` |
| `${os.shell}` | 현재 셸입니다. | `/bin/zsh` |
| `${os.version}` | 운영 체제 버전 설명입니다. | `Darwin Kernel Version ...` |
| `${os.release}` | 운영 체제 릴리스입니다. | `24.5.0` |
| `${os.hostname}` | 현재 호스트 이름입니다. | `MacBook-Pro.local` |
| `${os.availableParallelism}` | 사용 가능한 병렬성입니다. | `10` |
| `${os.totalMemory}` | 시스템 총 메모리(바이트 단위)입니다. | `34359738368` |
| `${os.freeMemory}` | 사용 가능한 메모리(바이트 단위)입니다. | `8589934592` |
| `${os.uptime}` | 시스템 가동 시간(초 단위)입니다. | `123456` |

## Node.js 런타임

| Variable | Description | Example |
|---|---|---|
| `${runtime.nodeVersion}` | 현재 Node.js 버전입니다. | `v24.14.0` |
| `${runtime.execPath}` | 현재 Node.js 실행 파일의 경로입니다. | `/opt/homebrew/bin/node` |
| `${runtime.pid}` | 현재 프로세스 ID입니다. | `12345` |
| `${runtime.ppid}` | 부모 프로세스 ID입니다. | `1234` |

## 시간

| Variable | Description | Example |
|---|---|---|
| `${time.current}` | 현재 로컬 시간 문자열입니다. | `Thu Jul 09 2026 18:22:09 GMT+0800 (China Standard Time)` |
| `${time.iso}` | 현재 ISO 시간입니다. | `2026-07-09T10:22:09.000Z` |
| `${time.date}` | 현재 로컬 날짜입니다. | `2026-07-09` |
| `${time.timezone}` | 현재 시스템 시간대입니다. | `Asia/Shanghai` |

## 권한 및 샌드박스

| Variable | Description | Example |
|---|---|---|
| `${permissions.mode}` | 현재 도구 권한 모드입니다. | `default` |
| `${permissions.approvalsReviewer}` | 현재 승인 정책 또는 검토자 모드입니다. | `auto_review` |
| `${sandbox.mode}` | 파일 시스템 샌드박스 모드입니다. | `workspace-write` |
| `${sandbox.networkAccess}` | 네트워크 액세스 상태입니다. | `enabled` |
| `${sandbox.writableRoots}` | 샌드박스가 쓰기를 허용하는 디렉토리입니다. 줄 바꿈으로 구분된 문자열로 렌더링될 수 있습니다. | `/Users/sky/Documents/Playground` |

## 터미널

| Variable | Description | Example |
|---|---|---|
| `${terminal.term}` | 현재 TERM입니다. | `xterm-256color` |
| `${terminal.colorTerm}` | 현재 COLORTERM입니다. | `truecolor` |
| `${terminal.columns}` | 현재 터미널 열 개수입니다. | `120` |
| `${terminal.rows}` | 현재 터미널 행 개수입니다. | `40` |

## 파일 시스템

| Variable | Description | Example |
|---|---|---|
| `${filesystem.tmpdir}` | 시스템 임시 디렉토리입니다. | `/var/folders/.../T` |
| `${filesystem.pathSeparator}` | 파일 경로 구분 기호입니다. | `/` |
| `${filesystem.pathDelimiter}` | PATH 항목 구분 기호입니다. | `:` |

## 모델

| Variable | Description | Example |
|---|---|---|
| `${model.name}` | 현재 모델 이름 또는 ID입니다. | `claude-opus-4-6` |
| `${model.knowledgeCutoff}` | 현재 모델 지식 차단일입니다. 이 값은 운영 체제에서 파생될 수 없으며 외부 구성 또는 재정의를 통해 주입되어야 합니다. | `May 2025` |

## Git

| Variable | Description | Example |
|---|---|---|
| `${git.isRepository}` | 현재 디렉토리가 git 저장소 내부에 있는지 여부(문자열)입니다. | `true` |
| `${git.root}` | Git 저장소 루트 디렉토리입니다. | `/Users/sky/project` |
| `${git.branch}` | 현재 git 분기 또는 짧은 HEAD 해시입니다. | `main` |
| `${git.mainBranch}` | 기본 주 분기로 일반적으로 PR 또는 병합 대상으로 사용됩니다. | `main` |
| `${git.userName}` | 현재 git `user.name`입니다. | `Sky` |
| `${git.status}` | `git status --short`의 출력입니다. | `M src/index.ts` |
| `${git.recentCommits}` | 최근 커밋의 요약입니다. | `abc1234 Fix prompt builder` |

## 메모리

메모리 변수는 영구 파일 기반 메모리 디렉토리를 설명합니다. `CC_MEMORY_DIR` / `CLAUDE_MEMORY_DIR` 재정의가 설정되면 `${memory.dir}`에서 해결됩니다. 그렇지 않으면 `<home>/.claude/projects/<slug>/memory/`로 계산되며, 여기서 `<slug>`는 주 작업 디렉토리이고 모든 영숫자가 아닌 문자는 `-`로 대체됩니다. `${memory.index}`는 해당 디렉토리 내 `MEMORY.md`의 내용(각 세션에 로드되는 인덱스)을 보유하고, `${memory.enabled}`는 메모리 사용 가능 여부를 보고합니다. `# Memory` 및 `# Memory index` 섹션은 메모리가 활성화된 경우에만 조립됩니다.

| Variable | Description | Example |
|---|---|---|
| `${memory.dir}` | 해결된 메모리 디렉토리입니다. | `/Users/sky/.claude/projects/-Users-sky-project/memory/` |
| `${memory.index}` | `MEMORY.md`의 내용 또는 없을 때 `""`입니다. | `# Memory index\n- [Commit to main](commit-to-main.md) — hook` |
| `${memory.enabled}` | 메모리 사용 가능 여부(문자열)입니다. | `true` |

## 스크래치패드

스크래치패드 디렉토리는 세션별이며 운영 체제에서 파생될 수 없습니다. `CC_SCRATCHPAD_DIR` / `CLAUDE_SCRATCHPAD_DIR` 재정의를 통해 주입되어야 합니다. 설정되지 않으면 `""`로 대체되고 `# Scratchpad Directory` 섹션은 조립에서 생략됩니다.

| Variable | Description | Example |
|---|---|---|
| `${scratchpad.dir}` | 세션별 임시 디렉토리입니다. | `/private/tmp/claude-501/<slug>/<session>/scratchpad` |
