# EnterPlanMode

## 定義

將 Claude Code 切換到規劃模式，用於在實施前探索程式碼庫並設計方案。

## 參數

無參數。

## 使用場景

**適合使用：**
- 新功能實作——需要架構決策
- 存在多種可行方案——需要使用者選擇
- 程式碼修改影響現有行為或結構
- 多檔案變更——可能涉及 2-3 個以上檔案
- 需求不明確——需要先探索再理解範圍
- 使用者偏好很重要——實作可以有多種合理方向

**不適合使用：**
- 單行或少量行的修復（拼寫錯誤、明顯 bug）
- 使用者已給出非常具體的指令
- 純研究/探索任務——應使用 Task（Explore 類型）

## 規劃模式中的行為

進入規劃模式後，Claude Code 會：
1. 使用 Glob、Grep、Read 工具深入探索程式碼庫
2. 理解現有模式和架構
3. 設計實施方案
4. 將方案提交給使用者審批
5. 如需澄清可使用 AskUserQuestion
6. 方案就緒後透過 ExitPlanMode 退出

## 注意事項

- 此工具需要使用者同意才能進入規劃模式
- 如果不確定是否需要規劃，傾向於規劃——提前對齊比返工好

## 在 cc-viewer 中的意義

EnterPlanMode 呼叫在請求日誌中表現為 `tool_use` content block。進入規劃模式後的請求序列通常以探索性工具呼叫（Glob、Grep、Read）為主，直到 ExitPlanMode 被呼叫。

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
