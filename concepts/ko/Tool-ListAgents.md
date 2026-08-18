# ListAgents

`SendMessage`를 보낼 수 있는 agent를 나열합니다: 여러분이 생성한 프로세스 내 서브에이전트, 이 머신의 다른 로컬 Claude 세션, 클라우드 세션(이 세션에 클라우드 액세스가 있을 때), 그리고 — 원격 제어가 연결된 경우 — 여러분 계정의 다른 세션. 각 행은 종류별로 라벨이 붙습니다.

## 사용 시점

- 메시지를 보내기 전에 피어 세션이나 서브에이전트의 정확한 이름이 필요합니다.
- 이 세션에서 현재 도달 가능한 세션을 확인하고 싶습니다.

## 활성화

- Claude Code 2.1.224+ 및 세션 간 메시징(서버 측 기능 플래그, 기본적으로 꺼짐)이 필요합니다.
- 세션 간 메시징은 Amazon Bedrock, AWS의 Claude Platform, Google Cloud Agent Platform, Microsoft Foundry에서 사용할 수 없습니다.
- `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `DISABLE_TELEMETRY`, `DO_NOT_TRACK`, 또는 `DISABLE_GROWTHBOOK`이 설정되면 꺼집니다.
- `CLAUDE_CODE_HARBOR_KITE=1`로 강제 활성화할 수 있습니다.

## 매개변수

- `channel` (string, 선택): 이 빌드에서는 사용할 수 없습니다. 설정하지 않은 채로 두십시오.
- `q` (string, 선택): 이 빌드에서는 사용할 수 없습니다. 설정하지 않은 채로 두십시오.

## 예시

### 예시 1: 도달 가능한 agent 나열

```
ListAgents()
```

각 행은 이름을 출력합니다 — 그 이름이 주소입니다. `SendMessage({to: "<name>", message: "..."})`로 보내되, 이름을 출력된 그대로 정확히 복사하십시오. 행의 ` [ref]`는 베어 이름이 모호할 때만(두 행이 공유하거나 오류가 명확화를 요구할 때) 덧붙이십시오.

## 참고사항

- 읽기 전용이며 동시성에 안전합니다.
- 클라우드 세션은 메시지를 받을 수는 있지만 아직 답장할 수 없습니다 — 해당 세션의 트랜스크립트에서 답을 읽으십시오.
