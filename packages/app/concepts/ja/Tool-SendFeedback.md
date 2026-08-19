# SendFeedback

セッションを離れることなく、Claude Code に関する構造化フィードバック — バグ報告、機能アイデア、欠けている機能 — を Anthropic に送信します。

## 使用タイミング

- ユーザーが Claude Code 自体に関するバグの報告やフィードバックの送信を求めた場合。
- 報告する価値のある明確なプロダクトの欠陥 (壊れたコマンド、誤った動作、クラッシュ) に遭遇した場合。
- ユーザーが存在してほしい機能 (アイデアや欠けている機能) を説明した場合。

## パラメータ

- `type` (string, required): `bug`、`idea`、`missing_capability` のいずれか。
- `title` (string, required): 問題の短く具体的な 1 行の要約。
- `details` (string, required): ラベル付き箇条書きを順に: **What happened:** (観察された動作と期待された動作、短ければ正確なエラーテキスト); **What the user said:** (引用、または "User didn't comment; observed by the model."); **Repro:** (最小の手順); **Evidence:** (リクエスト ID、タイムスタンプ、パス、バージョン — なければ省略); 任意で最後に **Cause:** をセッション内で検証できた場合のみ。各箇条書きは 1〜3 行。ナラティブな段落、推測、シークレットは含めないでください。
- `area` (string, optional): これがどの部分の Claude Code に関するものかを示す短いタグ (例: "hooks config"、"/help"、"file editing")。不明なら空のままにします。
- `failure_mode` (string, optional): モデル動作の報告の場合、最も近い失敗モード (例: `instruction_following`、`repetition_and_looping`、`context_and_memory`、`stopping_short`、または `other`)。報告が純粋なプロダクト/ツールのバグの場合のみ省略します。
- `task_category` (string, optional): 問題発生時にセッションが行っていた作業: `code_edit`、`debug`、`explain`、`plan`、`shell`、`search`、`review`、または `other`。

## 例

### 例 1: プロダクトのバグを報告

```
SendFeedback(
  type="bug",
  title="/export truncates the last message",
  details="**What happened:** exported transcript is missing the final assistant message.\n**What the user said:** \"the last reply never shows up in the file\".\n**Repro:** run /export after any multi-turn session.\n**Evidence:** v2.1.233, macOS.",
  area="/export",
  task_category="other"
)
```

## 注意事項

- `details` にシークレット、トークン、ユーザーのプライベートデータを決して含めないでください。
- 可能ならユーザーの言葉を引用してください。そうでなければ、モデルが問題を観察したと明記してください。
- 報告は事実に基づいてください — 根本原因の推測は、セッション内で検証できた場合にのみ `**Cause:**` に含めてください。
