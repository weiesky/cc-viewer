# SendUserMessage

ユーザーにメッセージを送信します — brief スタイルのセッションにおける主要な可視出力チャンネルです。レガシーエイリアス `Brief` としても知られています。

## 使用タイミング

- ユーザーが今言ったことへの返信 (`status="normal"`)。
- ユーザーが求めていないが今見る必要のあるものを先回りして提示する — ユーザーが離れている間にタスクが完了する、ヒットしたブロッカー、求められていないステータス更新 (`status="proactive"`)。

## 有効化

- 対話型セッションではデフォルトで非表示です。ほとんどの対話型 CLI セッションは代わりにユーザーと直接会話します。
- brief モードまたはサーバーサイドの機能フラグで有効化されます。

## パラメータ

brief モードの場合:

- `message` (string, required): ユーザーへのメッセージ。markdown フォーマットをサポートします。
- `attachments` (array, optional): メッセージと一緒に表示される添付。各エントリは、ローカルで読み取り可能なファイルのファイルパス (絶対パスまたは cwd からの相対パス)、または `attach_file` などのデバイスツールから取得した事前解決済みの `{file_uuid, file_name, size, is_image}` オブジェクトです。
- `status` (string, required): ユーザーが今必要とする求められていない更新には `proactive`。ユーザーへの返信には `normal`。

non-brief ビルドでは `message` のみが利用可能です。

## 例

### 例 1: 先回りの完了通知

```
SendUserMessage(
  message="The migration finished — 42 files updated, tests green.",
  status="proactive"
)
```

## 注意事項

- `proactive` は控えめに使用してください — 本当に今ユーザーの注意を必要とするもののためのものです。
