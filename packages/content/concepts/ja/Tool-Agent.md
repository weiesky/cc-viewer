# Agent

独自のコンテキストウィンドウを持つ自律的な Claude Code サブエージェントを起動し、焦点を絞ったタスクを処理して単一の統合された結果を返します。オープンエンドな調査、並列作業、チーム協業を委譲するための標準的な仕組みです。

## 使用タイミング

- 関連するファイルがまだ分からず、`Glob`、`Grep`、`Read` を複数回繰り返すことが予想されるオープンエンドな検索。
- 並列の独立した作業 — 単一のメッセージで複数のエージェントを起動して、別々の領域を同時に調査します。
- ノイズの多い探索をメインの会話から分離し、親コンテキストをコンパクトに保ちます。
- `Explore`、`Plan`、`claude-code-guide`、`statusline-setup` などの特化したサブエージェントタイプに委譲します。
- 協調的なマルチエージェント作業のため、アクティブなチームに名前付きのチームメイトを起動します。

対象となるファイルやシンボルがすでに分かっている場合には使用しないでください — 代わりに `Read`、`Grep`、`Glob` を直接使用してください。`Agent` を介した単一ステップの参照はコンテキストウィンドウを丸ごと浪費し、レイテンシを追加します。

## パラメータ

- `description` (string, required): タスクを説明する 3〜5 語の短いラベル。UI とログに表示されます。
- `prompt` (string, required): エージェントが実行する完全で自己完結したブリーフ。必要なコンテキスト、制約、期待される返却フォーマットをすべて含めなければなりません。
- `subagent_type` (string, optional): `general-purpose`、`Explore`、`Plan`、`claude-code-guide`、`statusline-setup` などのプリセットペルソナ。デフォルトは `general-purpose`。
- `run_in_background` (boolean, optional): true の場合、エージェントは非同期で実行され、親は作業を継続できます。結果は後で取得します。
- `model` (string, optional): このエージェントのモデルを上書きします — `opus`、`sonnet`、`haiku`。デフォルトは親セッションのモデルです。
- `isolation` (string, optional): `worktree` に設定すると、エージェントを分離された git worktree 内で実行し、ファイルシステムへの書き込みが親と衝突しないようにします。
- `team_name` (string, optional): 既存のチームに起動する場合、エージェントが参加するチーム識別子。
- `name` (string, optional): チーム内でアドレス指定可能なチームメイト名。`SendMessage` の `to` ターゲットとして使用されます。

## 例

### 例 1: オープンエンドなコード検索

```
Agent(
  description="Find auth middleware",
  subagent_type="Explore",
  prompt="Locate every place in this repo where JWT verification is performed. Return a bulleted list of absolute file paths with a one-line note about each site's role. Do not modify any files."
)
```

### 例 2: 並列の独立した調査

同じメッセージで 2 つのエージェントを起動します — 1 つはビルドパイプラインを調査し、もう 1 つはテストハーネスをレビューします。それぞれが独自のコンテキストウィンドウを取得し、サマリを返します。単一のツール呼び出しブロックにまとめることで並列実行されます。

### 例 3: 実行中のチームにチームメイトを起動

```
Agent(
  description="Data layer specialist",
  team_name="refactor-crew",
  name="db-lead",
  prompt="You are db-lead on team refactor-crew. Audit all Prisma schema files and propose a migration plan. Use SendMessage to report findings to the team leader."
)
```

## 注意事項

- エージェントは過去の実行を記憶しません。呼び出すたびにゼロから始まるので、`prompt` は完全に自己完結している必要があります — ファイルパス、規約、質問、期待される回答の形式を含めてください。
- エージェントは最終メッセージを 1 つだけ返します。実行中に確認の質問をすることはできないため、プロンプトの曖昧さは結果の推測につながります。
- サブタスクが独立している場合、並列で複数のエージェントを実行するのは逐次呼び出しよりもはるかに高速です。単一のツール呼び出しブロックにまとめてください。
- エージェントがファイルを書き込み、メインの作業ツリーにマージする前に変更をレビューしたい場合は、常に `isolation: "worktree"` を使用してください。
- 読み取り専用の偵察には `subagent_type: "Explore"` を、設計作業には `Plan` を優先してください。`general-purpose` は読み書き混在タスクのデフォルトです。
- バックグラウンドエージェント (`run_in_background: true`) は長時間実行ジョブに適しています。sleep ループでのポーリングは避けてください — 完了時に親に通知されます。
