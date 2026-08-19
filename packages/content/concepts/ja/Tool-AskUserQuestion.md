# AskUserQuestion

チャット UI 内で 1 つ以上の構造化された選択式の質問をユーザーに提示し、選択を収集してアシスタントに返します — 自由記述のやり取りなしに意図を明確化するのに便利です。

## 使用タイミング

- リクエストに複数の妥当な解釈があり、進める前にユーザーに 1 つ選んでもらう必要がある場合。
- 自由テキストの返信だとエラーになりやすい具体的な選択肢 (フレームワーク、ライブラリ、ファイルパス、戦略) から選ぶ必要がある場合。
- プレビューペインを使用して選択肢を並べて比較したい場合。
- やり取りを減らすため、複数の関連する決定を 1 つのプロンプトにまとめたい場合。
- プランやツール呼び出しが、ユーザーがまだ指定していない設定に依存している場合。

## パラメータ

- `questions` (array, required): 1 つのプロンプトで一緒に表示される 1〜4 個の質問。各質問オブジェクトには以下が含まれます。
  - `question` (string, required): 疑問符で終わる完全な質問テキスト。
  - `header` (string, required): 質問の上にチップとして表示される短いラベル (最大 12 文字)。
  - `options` (array, required): 2〜4 個の選択肢オブジェクト。各選択肢には `label` (1〜5 語)、`description`、オプションの `markdown` プレビューがあります。
  - `multiSelect` (boolean, required): `true` の場合、ユーザーは複数の選択肢を選べます。

## 例

### 例 1: 単一フレームワークの選択

```
AskUserQuestion(questions=[{
  "header": "Test runner",
  "question": "Which test runner should I configure?",
  "multiSelect": false,
  "options": [
    {"label": "Vitest (Recommended)", "description": "Fast, Vite-native, Jest-compatible API"},
    {"label": "Jest",                  "description": "Mature, broadest plugin ecosystem"},
    {"label": "Node --test",           "description": "Zero dependencies, built in"}
  ]
}])
```

### 例 2: 2 つのレイアウトを並べてプレビュー

```
AskUserQuestion(questions=[{
  "header": "Layout",
  "question": "Which dashboard layout do you prefer?",
  "multiSelect": false,
  "options": [
    {"label": "Sidebar",  "description": "Nav on the left", "markdown": "```\n+------+---------+\n| NAV  | CONTENT |\n+------+---------+\n```"},
    {"label": "Top bar",  "description": "Nav across top",  "markdown": "```\n+-----------------+\n|       NAV       |\n+-----------------+\n|     CONTENT     |\n+-----------------+\n```"}
  ]
}])
```

## 注意事項

- UI は各質問に自動的に「Other」自由記述オプションを追加します。独自の「Other」、「None」、「Custom」エントリを追加しないでください — 組み込みのエスケープハッチと重複します。
- 各呼び出しは 1〜4 個の質問、各質問は 2〜4 個の選択肢に制限してください。この範囲を超えるとハーネスによって拒否されます。
- 特定の選択肢を推奨する場合は、それを先頭に置き、ラベルに「(Recommended)」を付けて UI が優先パスを強調表示するようにしてください。
- `markdown` フィールドによるプレビューは単一選択の質問でのみサポートされます。ASCII レイアウト、コードスニペット、設定差分などの視覚的なアーティファクトに使用してください — ラベルと説明で十分な単純な好みの質問には使用しないでください。
- 質問のいずれかの選択肢に `markdown` 値がある場合、UI は選択肢リストを左、プレビューを右に表示する並列レイアウトに切り替わります。
- 「このプランはどうですか？」と尋ねるのに `AskUserQuestion` を使用しないでください — プラン承認のために存在する `ExitPlanMode` を呼び出してください。プランモード中は、質問テキストで「the plan」に言及することも避けてください。`ExitPlanMode` が実行されるまでプランはユーザーに見えません。
- API キーやパスワードなどの機密情報や自由記述の入力を要求するためにこのツールを使用しないでください。代わりにチャットで質問してください。
