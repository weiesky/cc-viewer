# ReadMcpResourceDir

接続された MCP サーバーが公開するディレクトリ型リソースのエントリを、その URI で指定して一覧表示します。

## 使用タイミング

- MCP サーバーがリソースを階層的に整理しており、その階層の 1 レベルを列挙する必要がある場合。
- `ReadMcpResource` で個々のリソースを読み取る前にブラウズしたい場合。

## パラメータ

- `server` (string, required): MCP サーバー名。
- `uri` (string, required): 一覧表示するディレクトリリソースの URI。

## 例

### 例 1: リソースディレクトリを一覧表示

```
ReadMcpResourceDir(server="filesystem", uri="file:///project/src/")
```

そのディレクトリ URI の下でサーバーが公開する子エントリを返します。

## 注意事項

- リソースをディレクトリとしてモデル化するサーバーのみがこれをサポートします。フラットなサーバーはエラーまたは空の一覧を返します — `ListMcpResources` にフォールバックしてください。
- `ReadMcpResource` と組み合わせて、関連しそうなエントリに掘り下げてください。
