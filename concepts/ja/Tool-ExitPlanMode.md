# ExitPlanMode

## 定義

計画モードを終了し、方針をユーザー承認に提出します。方針の内容は以前書き込まれた計画ファイルから読み取られます。

## パラメータ

| パラメータ | 型 | 必須 | 説明 |
|------------|------|------|------|
| `allowedPrompts` | array | いいえ | 実装方針に必要な権限の説明リスト |

`allowedPrompts` 配列の各要素：

| フィールド | 型 | 必須 | 説明 |
|------------|------|------|------|
| `tool` | enum | はい | 適用するツール、現在は `Bash` のみサポート |
| `prompt` | string | はい | 操作のセマンティック説明（例："run tests"、"install dependencies"） |

## 使用シナリオ

**適している場合：**
- 計画モードで方針が完成し、ユーザー承認に提出する準備ができた
- コードを書く必要がある実装タスクにのみ使用

**適していない場合：**
- 純粋な調査/探索タスク——計画モードを終了する必要はない
- ユーザーに「方針でよろしいですか？」と聞きたい場合——これがまさにこのツールの機能であり、AskUserQuestion で聞かないこと

## 注意事項

- このツールは方針の内容をパラメータとして受け取らない——以前書き込まれた計画ファイルから読み取る
- ユーザーは計画ファイルの内容を見て承認する
- このツールを呼び出す前に AskUserQuestion で「方針は大丈夫ですか」と聞かないこと。重複になる
- 質問の中で「計画」に言及しないこと。ユーザーは ExitPlanMode の前に計画の内容を見ることができないため

## cc-viewer での意義

ExitPlanMode 呼び出しは計画フェーズの終了を示します。リクエストログでは、この呼び出し以降のリクエストは通常、実装的な操作（Edit、Write、Bash など）に移行します。

## 原文

<textarea readonly>Use this tool when you are in plan mode and have finished writing your plan to the plan file and are ready for user approval.

## How This Tool Works
- You should have already written your plan to the plan file specified in the plan mode system message
- This tool does NOT take the plan content as a parameter - it will read the plan from the file you wrote
- This tool simply signals that you're done planning and ready for the user to review and approve
- The user will see the contents of your plan file when they review it

## When to Use This Tool
IMPORTANT: Only use this tool when the task requires planning the implementation steps of a task that requires writing code. For research tasks where you're gathering information, searching files, reading files or in general trying to understand the codebase - do NOT use this tool.

## Before Using This Tool
Ensure your plan is complete and unambiguous:
- If you have unresolved questions about requirements or approach, use AskUserQuestion first (in earlier phases)
- Once your plan is finalized, use THIS tool to request approval

**Important:** Do NOT use AskUserQuestion to ask "Is this plan okay?" or "Should I proceed?" - that's exactly what THIS tool does. ExitPlanMode inherently requests user approval of your plan.

## Examples

1. Initial task: "Search for and understand the implementation of vim mode in the codebase" - Do not use the exit plan mode tool because you are not planning the implementation steps of a task.
2. Initial task: "Help me implement yank mode for vim" - Use the exit plan mode tool after you have finished planning the implementation steps of the task.
3. Initial task: "Add a new feature to handle user authentication" - If unsure about auth method (OAuth, JWT, etc.), use AskUserQuestion first, then use exit plan mode tool after clarifying the approach.
</textarea>
