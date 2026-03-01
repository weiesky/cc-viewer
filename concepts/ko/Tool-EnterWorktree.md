# EnterWorktree

## 정의

격리된 git worktree를 생성하고 현재 세션을 해당 worktree로 전환합니다. 사용자가 명시적으로 worktree 작업을 요청할 때만 사용합니다.

## 매개변수

| 매개변수명 | 타입 | 필수 | 설명 |
|---|---|---|---|
| name | string | 아니오 | worktree 이름. 제공하지 않으면 임의의 이름이 생성됩니다. |

## 사용 사례

**적합한 경우:**
- 사용자가 명시적으로 "worktree"라고 말한 경우 (예: "worktree 생성", "worktree에서 작업")

**적합하지 않은 경우:**
- 사용자가 브랜치 생성/전환을 요청 — git 명령어 사용
- 사용자가 버그 수정이나 기능 개발을 요청 — worktree를 명시하지 않는 한 일반 git 워크플로우 사용

## 참고사항

- git 저장소 내에 있거나 WorktreeCreate/WorktreeRemove hooks가 구성되어 있어야 함
- 이미 worktree 내에 있으면 안 됨

## cc-viewer에서의 의미

EnterWorktree 호출은 요청 로그에 `tool_use` content block으로 나타납니다. 격리된 작업 환경을 생성하며, 이후 파일 작업은 worktree 디렉토리 내에서 수행됩니다.

## 원문

<textarea readonly>Use this tool ONLY when the user explicitly asks to work in a worktree. This tool creates an isolated git worktree and switches the current session into it.

## When to Use

- The user explicitly says "worktree" (e.g., "start a worktree", "work in a worktree", "create a worktree", "use a worktree")

## When NOT to Use

- The user asks to create a branch, switch branches, or work on a different branch — use git commands instead
- The user asks to fix a bug or work on a feature — use normal git workflow unless they specifically mention worktrees
- Never use this tool unless the user explicitly mentions "worktree"

## Requirements

- Must be in a git repository, OR have WorktreeCreate/WorktreeRemove hooks configured in settings.json
- Must not already be in a worktree

## Behavior

- In a git repository: creates a new git worktree inside `.claude/worktrees/` with a new branch based on HEAD
- Outside a git repository: delegates to WorktreeCreate/WorktreeRemove hooks for VCS-agnostic isolation
- Switches the session's working directory to the new worktree
- On session exit, the user will be prompted to keep or remove the worktree

## Parameters

- `name` (optional): A name for the worktree. If not provided, a random name is generated.
</textarea>
