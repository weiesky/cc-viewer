# EnterPlanMode

## 定義

Claude Code を計画モードに切り替え、実装前にコードベースを探索し方針を設計するために使用します。

## パラメータ

パラメータなし。

## 使用シナリオ

**適している場合：**
- 新機能の実装——アーキテクチャの判断が必要
- 複数の実行可能な方針がある——ユーザーの選択が必要
- コード変更が既存の動作や構造に影響する
- 複数ファイルの変更——2〜3ファイル以上に及ぶ可能性
- 要件が不明確——まず探索して範囲を理解する必要がある
- ユーザーの好みが重要——実装に複数の合理的な方向性がある

**適していない場合：**
- 1行または少数行の修正（タイプミス、明らかなバグ）
- ユーザーが非常に具体的な指示を出している
- 純粋な調査/探索タスク——Task（Explore タイプ）を使用すべき

## 計画モードでの動作

計画モードに入ると、Claude Code は：
1. Glob、Grep、Read ツールを使用してコードベースを深く探索
2. 既存のパターンとアーキテクチャを理解
3. 実装方針を設計
4. 方針をユーザー承認に提出
5. 必要に応じて AskUserQuestion で確認
6. 方針が準備できたら ExitPlanMode で終了

## 注意事項

- このツールは計画モードに入るためにユーザーの同意が必要
- 計画が必要かどうか不確かな場合は、計画する方に傾ける——事前の擦り合わせは手戻りよりも良い

## cc-viewer での意義

EnterPlanMode 呼び出しはリクエストログで `tool_use` content block として表示されます。計画モードに入った後のリクエストシーケンスは通常、探索的なツール呼び出し（Glob、Grep、Read）が中心となり、ExitPlanMode が呼び出されるまで続きます。

## 原文

<textarea readonly>Use this tool proactively when you're about to start a non-trivial implementation task. Getting user sign-off on your approach before writing code prevents wasted effort and ensures alignment. This tool transitions you into plan mode where you can explore the codebase and design an implementation approach for user approval.

## When to Use This Tool

**Prefer using EnterPlanMode** for implementation tasks unless they're simple. Use it when ANY of these conditions apply:

1. **New Feature Implementation**: Adding meaningful new functionality
   - Example: "Add a logout button" - where should it go? What should happen on click?
   - Example: "Add form validation" - what rules? What error messages?

2. **Multiple Valid Approaches**: The task can be solved in several different ways
   - Example: "Add caching to the API" - could use Redis, in-memory, file-based, etc.
   - Example: "Improve performance" - many optimization strategies possible

3. **Code Modifications**: Changes that affect existing behavior or structure
   - Example: "Update the login flow" - what exactly should change?
   - Example: "Refactor this component" - what's the target architecture?

4. **Architectural Decisions**: The task requires choosing between patterns or technologies
   - Example: "Add real-time updates" - WebSockets vs SSE vs polling
   - Example: "Implement state management" - Redux vs Context vs custom solution

5. **Multi-File Changes**: The task will likely touch more than 2-3 files
   - Example: "Refactor the authentication system"
   - Example: "Add a new API endpoint with tests"

6. **Unclear Requirements**: You need to explore before understanding the full scope
   - Example: "Make the app faster" - need to profile and identify bottlenecks
   - Example: "Fix the bug in checkout" - need to investigate root cause

7. **User Preferences Matter**: The implementation could reasonably go multiple ways
   - If you would use AskUserQuestion to clarify the approach, use EnterPlanMode instead
   - Plan mode lets you explore first, then present options with context

## When NOT to Use This Tool

Only skip EnterPlanMode for simple tasks:
- Single-line or few-line fixes (typos, obvious bugs, small tweaks)
- Adding a single function with clear requirements
- Tasks where the user has given very specific, detailed instructions
- Pure research/exploration tasks (use the Agent tool with explore agent instead)

## What Happens in Plan Mode

In plan mode, you'll:
1. Thoroughly explore the codebase using Glob, Grep, and Read tools
2. Understand existing patterns and architecture
3. Design an implementation approach
4. Present your plan to the user for approval
5. Use AskUserQuestion if you need to clarify approaches
6. Exit plan mode with ExitPlanMode when ready to implement

## Examples

### GOOD - Use EnterPlanMode:
User: "Add user authentication to the app"
- Requires architectural decisions (session vs JWT, where to store tokens, middleware structure)

User: "Optimize the database queries"
- Multiple approaches possible, need to profile first, significant impact

User: "Implement dark mode"
- Architectural decision on theme system, affects many components

User: "Add a delete button to the user profile"
- Seems simple but involves: where to place it, confirmation dialog, API call, error handling, state updates

User: "Update the error handling in the API"
- Affects multiple files, user should approve the approach

### BAD - Don't use EnterPlanMode:
User: "Fix the typo in the README"
- Straightforward, no planning needed

User: "Add a console.log to debug this function"
- Simple, obvious implementation

User: "What files handle routing?"
- Research task, not implementation planning

## Important Notes

- This tool REQUIRES user approval - they must consent to entering plan mode
- If unsure whether to use it, err on the side of planning - it's better to get alignment upfront than to redo work
- Users appreciate being consulted before significant changes are made to their codebase
</textarea>
