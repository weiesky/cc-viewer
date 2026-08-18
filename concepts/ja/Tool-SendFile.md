# SendFile

1 つ以上のファイルを別の Claude Code セッション — `ListAgents` でリストされるピア、または明示的なセッションアドレス — に送信します。

## 使用タイミング

- ピアセッションが自身のタスクを続行するために作業ディレクトリ内のファイル (レポート、パッチ、フィクスチャ) を必要としている場合。
- セッション間で作業を調整しており、テキストだけでなく成果物を引き渡したい場合 (テキストには `SendMessage` を使用してください)。

## 有効化

- クロスセッションファイル転送がセッションで利用可能でなければなりません。利用できない場合、検証は "Cross-session file transfer is not available in this session." で失敗します。
- `ListAgents` と同じクロスセッションメッセージング条件によってゲートされます (サーバーサイドの機能フラグ、デフォルトではオフ)。

## パラメータ

- `to` (string, required): 受信者 — `ListAgents` からのピアセッション名、または明示的な `uds:<socket>` / `bridge:<session id>` アドレス。
- `files` (array of strings, required): 送信するファイルパス (絶対パスまたは cwd からの相対パス)。単一ファイルでも常に配列で渡してください。1〜16 ファイル、各最大 30 MiB。
- `message` (string, optional): ファイルと一緒に届けられる短いメッセージ。

## 例

### 例 1: ピアセッションにレポートを送信

```
SendFile(
  to="teammate-a",
  files=["./dist/report.html"],
  message="The analysis you asked for"
)
```

## 注意事項

- リモートマシンへの転送には追加の承認が必要な場合があります。
- ファイル内容の読み取りは送信の一部です — 権限ルールによってファイル読み取りが無効化されている場合は拒否されます。
