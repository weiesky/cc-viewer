# ProposeGoal

セッションの検証可能な完了ゴールを提案します。ゴールは (デフォルトでは) 承認ダイアログでユーザーに表示され、一度設定されると、会話の残りをチェック可能な結果へと導きます。

## 使用タイミング

- セッションに、評価者が会話から検証できる具体的な終了状態がある場合 (例: "all tests in test/auth pass")。
- 大きな作業の前に、「完了」の意味についてユーザーの明示的な承認を得たい場合。
- ユーザー自身の言葉がすでに結果を述べており、それをセッションゴールとして記録したい場合。

## 有効化

- デフォルトではオフです (サーバーサイドの機能フラグ)。
- 対話型セッションとバックグラウンドセッションでは除外されます。
- `modelProposedGoals: "disabled"` 設定キーでオフになります。

## パラメータ

- `condition` (string, required): 完了条件。別の評価者が会話から検証できるように書きます (例: "all tests in test/auth pass (bun test exits 0)")。最大 500 文字 — ユーザーは承認ダイアログで条件全体を読める必要があります。
- `ask_user` (boolean, optional): ゴールが設定される前にユーザーに承認を求めるかどうか。デフォルトは true (承認ダイアログが表示されます)。この会話におけるユーザー自身の言葉がこの結果を望んでいることを述べている場合にのみ false を設定してください。その場合ゴールは可視の通知付きで直接設定され、ユーザーは `/goal clear` でクリアできます。

## 例

### 例 1: テストに裏付けられたゴールを提案

```
ProposeGoal(condition="npm run test exits 0 with the new catalog cases included")
```

ユーザーは承認ダイアログで条件を確認し、承認、編集、拒否できます。

### 例 2: ユーザーの述べた結果を直接採用

```
ProposeGoal(condition="the login form validates email format and shows an inline error", ask_user=false)
```

会話の前段でユーザーがその結果を明示的に述べた場合のみ有効です。

## 注意事項

- `condition` は短く、客観的にチェック可能に保ってください — 曖昧なゴール ("make it better") は目的を損ないます。
- `ask_user=false` は、ユーザー自身が述べた結果に厳密に限定されます。それ以外は承認ダイアログを通す必要があります。
