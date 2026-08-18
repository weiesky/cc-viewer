# TodoWrite

現在のセッション用に構造化 todo リストを書き込み、以前のリストを置き換えます。各項目はテキスト、ステータス、進捗インジケーターに表示される現在進行形のテキストを持ちます。

## 使用タイミング

- タスクに複数の明確なステップがあり、進捗を追跡することであなた（とユーザー）が進行状況を確認できる場合。
- ユーザーが明示的に todo リストを求めた場合。
- ちょうど 1 つの項目を進行中としてマークし、残りを保留または完了のままにしたい場合。

## 有効化

- レガシーツールです: Task ツール (`TaskCreate`、`TaskUpdate`、`TaskList`) を提供するセッションではデフォルトで無効化されます。
- `CLAUDE_CODE_ENABLE_TASKS=0` で再度有効化できます。

## パラメータ

- `todos` (array, required): 更新後の完全な todo リスト。各エントリには以下が含まれます:
  - `content` (string): タスクの説明。
  - `status` (string): `pending`、`in_progress`、`completed` のいずれか。
  - `activeForm` (string): 項目の進行中に表示される現在進行形のテキスト (例: "Running tests")。

## 例

### 例 1: 3 ステップの変更を追跡

```
TodoWrite(
  todos=[
    {content="Update the parser", status="in_progress", activeForm="Updating the parser"},
    {content="Add unit tests", status="pending", activeForm="Adding unit tests"},
    {content="Run the full test suite", status="pending", activeForm="Running the full test suite"}
  ]
)
```

リスト全体は呼び出しごとに書き換えられます — 変更された項目だけでなく、常にすべての項目を含めてください。

## 注意事項

- リストは各呼び出しで丸ごと置き換えられます。1 つの項目を更新するには、新しいステータスで全項目を再送信してください。
- 一度にちょうど 1 つの項目を `in_progress` に保ってください。
- 構造化タスクツール (`TaskCreate`/`TaskUpdate`/`TaskList`) が有効なセッションでは、ハーネスが `TodoWrite` の代わりにそれらを提供する場合があります — 宣伝されているツールセットの方を優先してください。
