# REPL

セッション内の永続的な Node.js vm コンテキストで JavaScript を実行します。トップレベル `await` がサポートされており、ある呼び出しで定義した変数や関数は後の呼び出しでも利用可能です。

## 使用タイミング

- シェルのワンライナーよりコードで書く方が簡単な、素早い計算、データ変換、JSON の加工。
- 呼び出し間で中間状態を保持すべきマルチステップスクリプト (カウンター、蓄積された結果)。
- ファイルに書き込む前に、API やライブラリの動作を対話的に調べる。

## パラメータ

- `code` (string, required): 実行する JavaScript コード。トップレベル await をサポートします。状態は呼び出しをまたいで保持されます。
- `description` (string, optional): このスクリプトが何をするかの明確で簡潔な説明 (能動態、5〜10 語)。例: "Trace upgrade message to its GrowthBook flag"。
- `timeout` (number, optional): タイムアウト (ミリ秒)。デフォルトは 30000、最大 600000。

## 例

### 例 1: 状態を計算して再利用

```
REPL(code="const counts = new Map(); ['a','b','a'].forEach(k => counts.set(k, (counts.get(k)||0)+1)); counts.get('a')")
```

`2` を返します。`counts` は同じセッション内の後続の REPL 呼び出しでも定義されたままです。

### 例 2: 長めのタイムアウトでのトップレベル await

```
REPL(
  code="const res = await fetch('https://example.com/api'); await res.json()",
  description="Fetch example API and parse JSON",
  timeout=60000
)
```

## 注意事項

- 状態はセッションごとです。セッションを再起動するとすべての定義がクリアされます。
- これは JavaScript (Node) 環境です — シェルコマンド、ファイルシステムを多用する作業、非 JS ランタイムには Bash を使用してください。
- 長時間実行コードには明示的な `timeout` を設定してください。デフォルトの 30 秒では遅い処理はすべて終了させられます。
