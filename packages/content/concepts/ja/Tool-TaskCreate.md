# TaskCreate

現在のチームのタスクリスト (またはチームがアクティブでない場合はセッションのタスクリスト) に新しいタスクを作成します。追跡、委任、または後で再訪すべき作業項目を記録するために使用します。

## 使用タイミング

- ユーザーが明示的な追跡から恩恵を受けるマルチステップの作業を説明した場合。
- 大きなリクエストを個別に完了可能な小さな単位に分割している場合。
- タスクの途中でフォローアップが発見され、忘れるべきでない場合。
- チームメイトやサブエージェントに作業を引き渡す前に、意図の永続的な記録が必要な場合。
- プランモードで動作しており、各プランステップを具体的なタスクとして表現したい場合。

些細なワンショットアクション、純粋な会話、または 2〜3 の直接的なツール呼び出しで完了できるものには `TaskCreate` をスキップしてください。

## 有効化

- ほとんどのモデルでデフォルトで利用可能です。
- Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 以降のファミリー (v2.1.233+) では、`CLAUDE_CODE_ENABLE_TODO_TOOLS=1`、`--allowedTools`、または `--tools` でオプトインしない限り利用できません。
- タスクシステム全体は `CLAUDE_CODE_ENABLE_TASKS=false` で無効化されます。

## パラメータ

- `subject` (string, required): 短い命令型のタイトル。例 `Fix login redirect on Safari`。約 80 文字以内に保ってください。
- `description` (string, required): 詳細なコンテキスト — 問題、制約、受け入れ基準、将来の読者が必要とするファイルやリンク。チームメイトがコールドでピックアップするかのように書いてください。
- `activeForm` (string, optional): タスクが `in_progress` のときに表示される現在進行形のスピナーテキスト。例 `Fixing login redirect on Safari`。`subject` を反映しつつ -ing 形式にします。
- `metadata` (object, optional): タスクに添付される任意の構造化データ。一般的な用途: ラベル、優先度ヒント、外部チケット ID、またはエージェント固有の設定。

新しく作成されたタスクは常にステータス `pending` と所有者なしで始まります。依存関係 (`blocks`、`blockedBy`) は作成時には設定されません — 後で `TaskUpdate` で適用してください。

## 例

### 例 1

ユーザーが今提出したバグレポートをキャプチャします。

```
TaskCreate(
  subject: "Repair broken PDF export on Windows",
  description: "Users on Windows 11 report the export button produces a 0-byte file. Reproduce with sample doc in test/fixtures/export/, then fix the code path in src/export/pdf.ts. Acceptance: export writes a valid PDF and the existing export test suite passes.",
  activeForm: "Repairing broken PDF export on Windows"
)
```

### 例 2

セッションの開始時にエピックを追跡単位に分割します。

```
TaskCreate(
  subject: "Draft migration plan for auth service",
  description: "Produce a written plan covering rollout stages, rollback strategy, and monitoring. Output: docs/auth-migration.md.",
  activeForm: "Drafting migration plan for auth service",
  metadata: { "priority": "P1", "linearId": "AUTH-214" }
)
```

## 注意事項

- `subject` は命令形で、`activeForm` は現在進行形で書いてください。タスクが `in_progress` に遷移したときに UI が自然に読めるようになります。
- 重複を避けるため、作成前に `TaskList` を呼び出してください — チームリストはチームメイトとサブエージェントと共有されます。
- `description` や `metadata` にシークレットやクレデンシャルを含めないでください。タスクレコードはチームへのアクセス権を持つ全員に見えます。
- 作成後は、`TaskUpdate` でタスクをライフサイクルに沿って移動させてください。`in_progress` で黙って放置しないでください。
