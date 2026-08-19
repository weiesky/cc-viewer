# TaskUpdate

既存のタスクを変更します — ステータス、コンテンツ、所有権、メタデータ、または依存関係エッジ。これがタスクのライフサイクルを進める方法であり、Claude Code、チームメイト、サブエージェント間で作業が引き渡される方法です。

## 使用タイミング

- 作業中にタスクをステータスワークフローに沿って遷移させる。
- 自分 (または別のエージェント) を `owner` として割り当ててタスクを請求する。
- 問題についてより多く学んだら `subject` や `description` を洗練する。
- `addBlocks` / `addBlockedBy` で新しく発見された依存関係を記録する。
- 外部チケット ID や優先度ヒントなどの構造化された `metadata` を添付する。

## 有効化

- ほとんどのモデルでデフォルトで利用可能です。
- Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 以降のファミリー (v2.1.233+) では、`CLAUDE_CODE_ENABLE_TODO_TOOLS=1`、`--allowedTools`、または `--tools` でオプトインしない限り利用できません。
- タスクシステム全体は `CLAUDE_CODE_ENABLE_TASKS=false` で無効化されます。

## パラメータ

- `taskId` (string, required): 変更するタスク。`TaskList` または `TaskCreate` から取得。
- `status` (string, optional): `pending`、`in_progress`、`completed`、`deleted` のいずれか。
- `subject` (string, optional): 置換用の命令型タイトル。
- `description` (string, optional): 置換用の詳細な説明。
- `activeForm` (string, optional): 置換用の現在進行形スピナーテキスト。
- `owner` (string, optional): タスクの責任を取るエージェントまたはチームメイトのハンドル。
- `metadata` (object, optional): タスクにマージするメタデータキー。キーを `null` に設定すると削除されます。
- `addBlocks` (array of strings, optional): このタスクがブロックするタスク ID。
- `addBlockedBy` (array of strings, optional): このタスクの前に完了する必要があるタスク ID。

## ステータスワークフロー

ライフサイクルは意図的に線形です: `pending` → `in_progress` → `completed`。`deleted` は終端で、決して作業されないタスクを撤回するために使用します。

- 実際に作業を始めた瞬間に `in_progress` を設定してください、その前ではありません。特定の所有者に対して `in_progress` は一度に 1 つだけであるべきです。
- 作業が完全に完了したときのみ `completed` を設定してください — 受け入れ基準が満たされ、テストが通り、出力が書き込まれた。ブロッカーが現れた場合、タスクを `in_progress` のまま保ち、解決する必要があるものを記述する新しいタスクを追加してください。
- テストが失敗している、実装が部分的、または未解決のエラーに遭遇した場合は、決してタスクを `completed` としてマークしないでください。
- キャンセルまたは重複のタスクには `deleted` を使用してください。タスクを無関係な作業のために再利用しないでください。

## 例

### 例 1

タスクを請求して開始します。

```
TaskUpdate(
  taskId: "t_01HXYZ...",
  status: "in_progress",
  owner: "main-agent"
)
```

### 例 2

作業を終了し、フォローアップの依存関係を記録します。

```
TaskUpdate(
  taskId: "t_01HXYZ...",
  status: "completed"
)

TaskUpdate(
  taskId: "t_01FOLLOWUP...",
  addBlockedBy: ["t_01HXYZ..."]
)
```

## 注意事項

- `metadata` はキーごとにマージされます。キーに `null` を渡すと削除されます。現在の内容が不明な場合は、最初に `TaskGet` を呼び出してください。
- `addBlocks` と `addBlockedBy` はエッジを追加します。既存のものは削除しません。グラフを破壊的に編集するには専用のワークフローが必要です — 依存関係を書き換える前にチームオーナーに相談してください。
- `subject` を変更するときは `activeForm` を同期させて、スピナーテキストが自然に読めるようにしてください。
- 無音化するためにタスクを `completed` としてマークしないでください。ユーザーが作業をキャンセルした場合、`description` に簡単な根拠を付けて `deleted` を使用してください。
- 更新前に `TaskGet` でタスクの最新状態を読み取ってください — 最後の読み取りと書き込みの間にチームメイトが変更した可能性があります。
