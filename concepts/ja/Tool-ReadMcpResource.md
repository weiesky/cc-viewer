# ReadMcpResource

接続された MCP (Model Context Protocol) サーバーが公開する単一のリソースを、その URI で指定して読み取ります。

## 使用タイミング

- MCP サーバーがリソース (ファイル、レコード、ドキュメント) を公開しており、その内容がコンテキストに必要な場合。
- 具体的なリソース URI がある場合 — `ListMcpResources`、サーバーのドキュメント、または以前のツール結果から。

## パラメータ

- `server` (string, required): MCP サーバー名。
- `uri` (string, required): 読み取るリソース URI。

## 例

### 例 1: URI でサーバーリソースを読み取る

```
ReadMcpResource(server="github", uri="file:///repo/docs/architecture.md")
```

`github` MCP サーバーが提供するリソース内容を返します。

## 注意事項

- サーバーがどのリソースを公開しているか分からない場合は、まず `ListMcpResources` を使用してください。ディレクトリ型の一覧には `ReadMcpResourceDir` を使用してください。
- URI スキームはサーバー固有です (`file://`、`https://`、カスタムスキーム) — 対象サーバーが宣伝しているものを確認してください。
