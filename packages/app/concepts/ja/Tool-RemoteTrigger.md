# RemoteTrigger

claude.ai のリモートトリガー API を呼び出し、スケジュールされたタスクとオンデマンドのトリガー実行を管理します。OAuth トークンはツール内部で処理され、モデルやシェルに公開されることはありません。

## 使用タイミング

- claude.ai 上のリモートエージェント（トリガー）の管理 — 既存トリガーの一覧表示、検査、更新を含む
- cron ベースの自動化タスクの作成 — Claude エージェントを定期的なスケジュールで実行させる設定
- 次回のスケジュール実行を待たずに既存のトリガーをオンデマンドで実行
- すべての現在のトリガーを一覧表示または監査して、設定とステータスを確認
- トリガーを再作成せずに、スケジュール、ペイロード、説明などのトリガー設定を更新

## 有効化

- claude.ai の Pro、Max、Team、または Enterprise プランが必要です。
- Amazon Bedrock、Claude Platform on AWS、Google Cloud、Microsoft Foundry では利用できません。
- サーバーサイドの機能フラグと `allow_remote_sessions` / `allow_routines` ポリシー設定が必要です。
- リモートセッション自体では利用できません。

## パラメータ

- `action` (string, 必須): 実行する操作 — `list`、`get`、`create`、`update`、`run` のいずれか
- `trigger_id` (string, `get`、`update`、`run` では必須): 操作するトリガーの識別子。パターン `^[\w-]+$`（単語文字とダッシュのみ）に一致する必要がある
- `body` (object, `create` と `update` では必須；`run` では任意): API に送信されるリクエストペイロード

## 例

### 例 1: すべてのトリガーを一覧表示する

```json
{
  "action": "list"
}
```

`GET /v1/code/triggers` を呼び出し、認証済みアカウントに関連するすべてのトリガーの JSON 配列を返します。

### 例 2: 毎週平日の朝に実行される新しいトリガーを作成する

```json
{
  "action": "create",
  "body": {
    "name": "weekday-morning-report",
    "schedule": "0 8 * * 1-5",
    "description": "毎週平日 UTC 08:00 に日次サマリーを生成する"
  }
}
```

提供されたボディで `POST /v1/code/triggers` を呼び出し、割り当てられた `trigger_id` を含む新しく作成されたトリガーオブジェクトを返します。

### 例 3: トリガーをオンデマンドで実行する

```json
{
  "action": "run",
  "trigger_id": "my-report-trigger"
}
```

スケジュールされた時刻をバイパスして、即座に `POST /v1/code/triggers/my-report-trigger/run` を呼び出します。

### 例 4: 単一のトリガーを取得する

```json
{
  "action": "get",
  "trigger_id": "my-report-trigger"
}
```

`GET /v1/code/triggers/my-report-trigger` を呼び出し、完全なトリガー設定を返します。

## 注意事項

- OAuth トークンはツールによってプロセス内部に注入されます — トークンを手動でコピー、貼り付け、またはログに記録しないでください。これはセキュリティリスクを生じさせ、このツールを使用する場合は不要です。
- すべてのトリガー API 呼び出しには、生の `curl` や他の HTTP クライアントではなくこのツールを使用してください。直接 HTTP を使用すると、セキュアなトークン注入がバイパスされ、認証情報が公開される可能性があります。
- ツールは API からの生の JSON レスポンスを返します。呼び出し元はレスポンスを解析し、エラーステータスコードを処理する責任があります。
- `trigger_id` の値はパターン `^[\w-]+$` に一致する必要があります — 英数字、アンダースコア、ダッシュのみが許可されます。スペースや特殊文字が含まれるとリクエストが失敗します。
