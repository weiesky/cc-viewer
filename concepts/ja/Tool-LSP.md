# LSP

Language Server Protocol (LSP) サーバーに問い合わせてコードインテリジェンス — 定義、参照、ホバー、シンボル、実装、呼び出し階層 — を取得します。コードを意味的に理解するため、テキスト検索よりも正確です。

## 使用タイミング

- シンボルの定義へジャンプする (`goToDefinition`)、またはすべての参照を見つける (`findReferences`)
- シンボルの型シグネチャ / ドキュメントを読む (`hover`)
- 1 つのファイル内のシンボルを一覧する (`documentSymbol`)、またはプロジェクト全体で検索する (`workspaceSymbol`)
- インターフェースや抽象メソッドの実装を見つける (`goToImplementation`)
- 関数の呼び出し階層をたどる (`prepareCallHierarchy`、`incomingCalls`、`outgoingCalls`)

## 有効化

- その言語用のコードインテリジェンスプラグインがインストールされるまで非アクティブです (サーバーバイナリは別途インストールされます)。
- このツールは LSP クライアントが接続されているときのみ表示されます。

## パラメータ

- `operation` (string, required): 上記のいずれかの操作。
- `filePath` (string, required): 操作対象のファイル。
- `line` (number, required): エディタに表示される 1 始まりの行番号。
- `character` (number, required): エディタに表示される 1 始まりの文字オフセット。

## 注意事項

- そのファイルタイプ用に構成された LSP サーバーが必要です。そうでない場合、呼び出しはエラーを返します。
- line と character は 0 始まりではなく 1 始まり (エディタ座標) です。
- テキストの一致ではなく意味的なナビゲーション (真の定義/参照) が必要な場合は、`Grep` よりも LSP を優先してください。

## 関連概念

- コードをナビゲートして変更する際に `Read` と `Edit` を補完します。
