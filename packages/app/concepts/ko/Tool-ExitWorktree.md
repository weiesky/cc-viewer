# ExitWorktree

`EnterWorktree`로 생성된 worktree 세션을 종료하고 세션을 원래 작업 디렉터리로 되돌립니다. 이 도구는 현재 세션에서 `EnterWorktree`로 생성된 worktree에만 작동하며, 활성 세션이 없으면 아무 작업도 수행하지 않습니다.

## 사용 시점

- 격리된 worktree에서의 작업이 완료되어 메인 작업 디렉터리로 돌아가고 싶을 때.
- 피처 브랜치 worktree에서 작업을 완료하고 병합한 후 브랜치와 디렉터리를 정리하고 싶을 때.
- worktree를 나중에 다시 사용하기 위해 보존하면서, 아무것도 삭제하지 않고 원래 디렉터리로 돌아가고 싶을 때.
- 실험적이거나 임시 브랜치를 버리고 디스크에 아무 결과물도 남기고 싶지 않을 때.
- 새 `EnterWorktree` 세션을 시작하기 전에 현재 세션을 먼저 종료해야 할 때.

## 매개변수

- `action` (문자열, 필수): `"keep"`은 worktree 디렉터리와 브랜치를 디스크에 그대로 보존하여 나중에 돌아올 수 있게 하고, `"remove"`는 worktree 디렉터리와 브랜치를 모두 삭제하여 깔끔하게 종료합니다.
- `discard_changes` (불리언, 선택, 기본값 `false`): `action`이 `"remove"`일 때만 의미가 있습니다. worktree에 커밋되지 않은 파일이나 원래 브랜치에 없는 커밋이 있으면, `discard_changes`를 `true`로 설정하지 않는 한 도구가 삭제를 거부합니다. 오류 응답에는 해당 변경 사항 목록이 포함되므로 재호출 전에 사용자에게 확인할 수 있습니다.

## 예시

### 예시 1: 변경 사항 병합 후 깔끔한 종료

worktree에서 작업을 마치고 브랜치를 메인에 병합한 후, `action: "remove"`를 지정하여 `ExitWorktree`를 호출하면 worktree 디렉터리와 브랜치가 삭제되고 원래 작업 디렉터리로 돌아갑니다.

```
ExitWorktree(action: "remove")
```

### 예시 2: 커밋되지 않은 실험 코드가 있는 임시 worktree 버리기

worktree에 완전히 버려야 할 실험적인 미커밋 변경 사항이 있는 경우, 먼저 `action: "remove"`를 시도합니다. 도구가 거부하고 미커밋 변경 사항을 나열합니다. 변경 사항을 버려도 된다는 것을 사용자에게 확인한 후, `discard_changes: true`를 지정하여 다시 호출합니다.

```
ExitWorktree(action: "remove", discard_changes: true)
```

## 참고사항

- 이 도구는 현재 세션에서 `EnterWorktree`로 생성된 worktree에만 작동합니다. `git worktree add`로 생성한 worktree, 이전 세션의 worktree, 또는 `EnterWorktree`를 호출한 적이 없는 일반 작업 디렉터리에는 영향을 미치지 않으며, 이러한 경우에는 아무 작업도 수행하지 않습니다.
- worktree에 커밋되지 않은 변경 사항이나 원래 브랜치에 없는 커밋이 있으면, `discard_changes: true`를 명시적으로 지정하지 않는 한 `action: "remove"`는 거부됩니다. 데이터는 복구할 수 없으므로 `discard_changes: true`를 설정하기 전에 반드시 사용자에게 확인하십시오.
- worktree에 tmux 세션이 연결된 경우: `remove`에서는 해당 세션이 종료되고, `keep`에서는 세션이 계속 실행되며 나중에 사용자가 재연결할 수 있도록 세션 이름이 반환됩니다.
- `ExitWorktree` 완료 후 `EnterWorktree`를 다시 호출하여 새 worktree 세션을 시작할 수 있습니다.
