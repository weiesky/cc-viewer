# AskUserQuestion

## 定義

実行中にユーザーに質問し、確認の取得、仮説の検証、または判断の要求に使用します。

## パラメータ

| パラメータ | 型 | 必須 | 説明 |
|------------|------|------|------|
| `questions` | array | はい | 質問リスト（1〜4個の質問） |
| `answers` | object | いいえ | ユーザーから収集した回答 |
| `annotations` | object | いいえ | 各質問の注釈（プレビュー選択の備考など） |
| `metadata` | object | いいえ | トラッキングと分析用のメタデータ |

各 `question` オブジェクト：

| フィールド | 型 | 必須 | 説明 |
|------------|------|------|------|
| `question` | string | はい | 完全な質問テキスト。疑問符で終わること |
| `header` | string | はい | 短いラベル（最大12文字）、ラベルチップとして表示 |
| `options` | array | はい | 2〜4個の選択肢 |
| `multiSelect` | boolean | はい | 複数選択を許可するかどうか |

各 `option` オブジェクト：

| フィールド | 型 | 必須 | 説明 |
|------------|------|------|------|
| `label` | string | はい | 選択肢の表示テキスト（1〜5語） |
| `description` | string | はい | 選択肢の説明 |
| `markdown` | string | いいえ | プレビューコンテンツ（ASCII レイアウト、コードスニペットなどの視覚的比較用） |

## 使用シナリオ

**適している場合：**
- ユーザーの好みや要件を収集
- 曖昧な指示を明確化
- 実装中に判断を取得
- ユーザーに方向性の選択を提供

**適していない場合：**
- 「方針でよろしいですか？」と聞く場合——ExitPlanMode を使用すべき

## 注意事項

- ユーザーは常に "Other" を選択してカスタム入力を提供できる
- 推奨選択肢は最初に配置し、label の末尾に "(Recommended)" を追加
- `markdown` プレビューは単一選択の質問のみ対応
- `markdown` がある選択肢は左右並列レイアウトに切り替わる
- 計画モードでは、方針確定前の要件明確化に使用

## cc-viewer での意義

AskUserQuestion 呼び出しはリクエストログで `tool_use` content block として表示され、質問と選択肢の定義が含まれます。ユーザーの回答は後続リクエストのメッセージ履歴に表示されます。

## 原文

<textarea readonly>Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- Users will always be able to select "Other" to provide custom text input
- Use multiSelect: true to allow multiple answers to be selected for a question
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label

Plan mode note: In plan mode, use this tool to clarify requirements or choose between approaches BEFORE finalizing your plan. Do NOT use this tool to ask "Is my plan ready?" or "Should I proceed?" - use ExitPlanMode for plan approval. IMPORTANT: Do not reference "the plan" in your questions (e.g., "Do you have feedback about the plan?", "Does the plan look good?") because the user cannot see the plan in the UI until you call ExitPlanMode. If you need plan approval, use ExitPlanMode instead.

Preview feature:
Use the optional `markdown` field on options when presenting concrete artifacts that users need to visually compare:
- ASCII mockups of UI layouts or components
- Code snippets showing different implementations
- Diagram variations
- Configuration examples

When any option has a markdown, the UI switches to a side-by-side layout with a vertical option list on the left and preview on the right. Do not use previews for simple preference questions where labels and descriptions suffice. Note: previews are only supported for single-select questions (not multiSelect).
</textarea>
