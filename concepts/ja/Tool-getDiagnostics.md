# getDiagnostics (mcp__ide__getDiagnostics)

## 定義

VS Code から言語診断情報を取得します。構文エラー、型エラー、lint 警告などを含みます。

## パラメータ

| パラメータ | 型 | 必須 | 説明 |
|------------|------|------|------|
| `uri` | string | いいえ | ファイル URI。指定しない場合はすべてのファイルの診断情報を取得 |

## 使用シナリオ

**適している場合：**
- コードの構文、型、lint などのセマンティック問題をチェック
- コード編集後に新しいエラーが導入されていないか検証
- Bash コマンドの代わりにコード品質をチェック

**適していない場合：**
- テストの実行——Bash を使用すべき
- ランタイムエラーのチェック——Bash でコードを実行すべき

## 注意事項

- これは MCP（Model Context Protocol）ツールで、IDE 統合により提供
- VS Code / IDE 環境でのみ利用可能
- コード問題のチェックには Bash コマンドよりもこのツールを優先使用

## cc-viewer での意義

getDiagnostics は MCP ツールで、リクエストログの `tools` 配列に `mcp__ide__getDiagnostics` の名前で表示されます。その呼び出しと返却は標準の `tool_use` / `tool_result` パターンに従います。MCP ツールの増減は tools 配列の変化を引き起こし、キャッシュ再構築をトリガーする可能性があります。

## 原文

<textarea readonly>Get language diagnostics from VS Code</textarea>
