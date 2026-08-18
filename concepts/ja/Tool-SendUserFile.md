# SendUserFile

1 つ以上のファイル — 生成された成果物、スクリーンショット、レポート — をユーザーに送信し、クライアントがどう提示するかを制御します。

## 使用タイミング

- ユーザーが必要とするファイル (レポート、画像、HTML ページ) を生成し、パスを言及するだけでなくそれを提示したい場合。
- 添付付きで返信する (`status="normal"`)、またはユーザーが求めていないが今見る必要のあるものを先回りして提示する (`status="proactive"`)。

## パラメータ

- `files` (array of strings, required): ユーザーに送信するファイルパス (絶対パスまたは cwd からの相対パス)。単一ファイルでも常に配列で渡してください。
- `caption` (string, optional): ファイルの短いキャプション。
- `status` (string, required): ユーザーが求めていないが今見る必要のあるファイル — 生成された成果物や完了したレポート — を提示する場合は `proactive`。ユーザーが今言ったことへの返信の場合は `normal`。
- `display` (string, optional): `render` はサイドパネルでファイルをインライン表示します (HTML、SVG、Mermaid、画像、PDF)。`attach` はダウンロードカードのみを表示します (ユーザーが保存して別の場所で開く成果物向け)。省略するとクライアントがファイルタイプに応じて決定します。

## 例

### 例 1: 生成したレポートを届ける

```
SendUserFile(
  files=["./out/weekly-report.html"],
  caption="Weekly usage report",
  status="proactive",
  display="render"
)
```

## 注意事項

- セッションがファイル送信を許可している必要があります (設定/機能ゲート付きのケイパビリティ)。brief モードでは提供されません。
- ユーザーが保存して別のアプリで開くファイルには `display="attach"` を、すぐに見るべきものには `render` を選んでください。
