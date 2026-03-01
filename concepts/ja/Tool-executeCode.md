# executeCode (mcp__ide__executeCode)

## 定義

現在の notebook ファイルの Jupyter kernel で Python コードを実行します。

## パラメータ

| パラメータ | 型 | 必須 | 説明 |
|------------|------|------|------|
| `code` | string | はい | 実行する Python コード |

## 使用シナリオ

**適している場合：**
- Jupyter notebook 環境でコードを実行
- コードスニペットのテスト
- データ分析と計算

**適していない場合：**
- 非 Jupyter 環境でのコード実行——Bash を使用すべき
- ファイルの変更——Edit または Write を使用すべき

## 注意事項

- これは MCP（Model Context Protocol）ツールで、IDE 統合により提供
- コードは現在の Jupyter kernel で実行され、状態は呼び出し間で永続化
- ユーザーが明示的に要求しない限り、変数の宣言や kernel 状態の変更を避けるべき
- kernel 再起動後は状態が失われる

## cc-viewer での意義

executeCode は MCP ツールで、リクエストログの `tools` 配列に `mcp__ide__executeCode` の名前で表示されます。その呼び出しと返却は標準の `tool_use` / `tool_result` パターンに従います。MCP ツールの増減は tools 配列の変化を引き起こし、キャッシュ再構築をトリガーする可能性があります。

## 原文

<textarea readonly>Execute python code in the Jupyter kernel for the current notebook file.
    
    All code will be executed in the current Jupyter kernel.
    
    Avoid declaring variables or modifying the state of the kernel unless the user
    explicitly asks for it.
    
    Any code executed will persist across calls to this tool, unless the kernel
    has been restarted.</textarea>
