# SendMessage

アクティブなチーム内で 1 人のチームメンバーから別のチームメンバーにメッセージを配信するか、すべてのチームメイトに一度にブロードキャストします。これはチームメイトが聞ける唯一のチャンネルです — 通常のテキスト出力に書かれたものはチームメイトには見えません。

## 使用タイミング

- チーム協業中に名前付きチームメイトにタスクを割り当てたり、サブ問題を引き継ぐ。
- 別のエージェントにステータス、中間結果、またはコードレビューを要求する。
- `*` を介してチーム全体に決定、共有制約、またはシャットダウン通知をブロードキャストする。
- シャットダウン要求やチームリーダーからのプラン承認要求などのプロトコルプロンプトに応答する。
- 委任されたタスクの終わりにループを閉じ、リーダーがアイテムを完了としてマークできるようにする。

## 有効化

- `ListAgents` と同じクロスセッションメッセージング条件によってゲートされます (サーバーサイドの機能フラグ、デフォルトではオフ)。
- チームメイトにはさらに、実験的なエージェントチームの有効化が必要です。

## パラメータ

- `to` (string, required): チームに登録されている対象チームメイトの `name`、または `*` ですべてのチームメイトに一度にブロードキャスト。
- `message` (string or object, required): 通常の通信のためのプレーンテキスト、または `shutdown_response` や `plan_approval_response` のようなプロトコル応答のための構造化オブジェクト。
- `summary` (string, optional): プレーンテキストメッセージのチームアクティビティログに表示される 5〜10 語のプレビュー。長い文字列メッセージには必須。`message` がプロトコルオブジェクトの場合は無視されます。

## 例

### 例 1: 直接タスクの引き継ぎ

```
SendMessage(
  to="db-lead",
  message="Please audit prisma/schema.prisma and list any model missing createdAt/updatedAt timestamps. Reply when done.",
  summary="Audit schema for missing timestamps"
)
```

### 例 2: 共有制約のブロードキャスト

```
SendMessage(
  to="*",
  message="Reminder: do not touch files under legacy/ — that subtree is frozen until the migration PR lands.",
  summary="Freeze legacy/ during migration"
)
```

### 例 3: プロトコル応答

構造化メッセージを使ってリーダーからのシャットダウン要求に応答します。

```
SendMessage(
  to="leader",
  message={ "type": "shutdown_response", "ready": true, "final_report": "All assigned diff chunks committed on branch refactor-crew/db-lead." }
)
```

### 例 4: プラン承認応答

```
SendMessage(
  to="leader",
  message={ "type": "plan_approval_response", "approved": true, "notes": "LGTM, but please split step 4 into migration + backfill." }
)
```

## 注意事項

- 通常のアシスタントテキスト出力はチームメイトには伝わりません。別のエージェントに何かを見せたい場合は、`SendMessage` を通す必要があります。これはチームワークフローで最もよくある間違いです。
- ブロードキャスト (`to: "*"`) は高コストです — すべてのチームメイトを起こし、彼らのコンテキストを消費します。本当に全員に影響するアナウンスのために予約してください。ターゲットを絞った送信を優先してください。
- メッセージは簡潔で行動指向に保ってください。受信者が必要とするファイルパス、制約、期待される返信形式を含めてください。彼らにはあなたとの共有メモリがないことを覚えておいてください。
- プロトコルメッセージオブジェクト (`shutdown_response`、`plan_approval_response`) は固定された形状を持ちます。プロトコルフィールドをプレーンテキストメッセージに混ぜたり、その逆をしないでください。
- メッセージは非同期です。受信者は次のターンで受け取ります。返信があるまで、彼らが読んだり対応したと仮定しないでください。
- よく書かれた `summary` は、リーダーにとってチームアクティビティログをスキャンしやすくします — コミットのサブジェクト行のように扱ってください。
