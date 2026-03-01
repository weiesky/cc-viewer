# Skill

## 定義

メイン会話内でスキル（skill）を実行します。スキルはユーザーが slash command（例：`/commit`、`/review-pr`）で呼び出せる専用機能です。

## パラメータ

| パラメータ | 型 | 必須 | 説明 |
|------------|------|------|------|
| `skill` | string | はい | スキル名（例："commit"、"review-pr"、"pdf"） |
| `args` | string | いいえ | スキルの引数 |

## 使用シナリオ

**適している場合：**
- ユーザーが `/<skill-name>` 形式の slash command を入力した
- ユーザーのリクエストが登録済みスキルの機能にマッチする

**適していない場合：**
- 組み込み CLI コマンド（例：`/help`、`/clear`）
- 既に実行中のスキル
- 利用可能なスキルリストにないスキル名

## 注意事項

- スキルが呼び出されると完全なプロンプトに展開される
- 完全修飾名をサポート（例：`ms-office-suite:pdf`）
- 利用可能なスキルリストは system-reminder メッセージで提供される
- `<command-name>` タグが見えた場合はスキルが既にロード済みであり、このツールを再度呼び出さずに直接実行すべき
- 実際にツールを呼び出さずにスキルに言及しないこと

## cc-viewer での意義

Skill 呼び出しはリクエストログで `tool_use` content block として表示されます。スキル展開後のプロンプトは後続リクエストの system prompt やメッセージ内容に影響します。

## 原文

<textarea readonly>Execute a skill within the main conversation

When users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.

When users reference a "slash command" or "/<something>" (e.g., "/commit", "/review-pr"), they are referring to a skill. Use this tool to invoke it.

How to invoke:
- Use this tool with the skill name and optional arguments
- Examples:
  - `skill: "pdf"` - invoke the pdf skill
  - `skill: "commit", args: "-m 'Fix bug'"` - invoke with arguments
  - `skill: "review-pr", args: "123"` - invoke with arguments
  - `skill: "ms-office-suite:pdf"` - invoke using fully qualified name

Important:
- Available skills are listed in system-reminder messages in the conversation
- When a skill matches the user's request, this is a BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response about the task
- NEVER mention a skill without actually calling this tool
- Do not invoke a skill that is already running
- Do not use this tool for built-in CLI commands (like /help, /clear, etc.)
- If you see a <command-name> tag in the current conversation turn, the skill has ALREADY been loaded - follow the instructions directly instead of calling this tool again
</textarea>
