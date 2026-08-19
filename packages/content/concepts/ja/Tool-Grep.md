# Grep

ripgrep エンジンを使用してファイル内容を検索します。完全な正規表現サポート、ファイルタイプフィルタリング、3 つの出力モードを提供し、精度とコンパクトさをトレードオフできます。

## 使用タイミング

- 関数のすべての呼び出し箇所や識別子のすべての参照を特定
- 文字列やエラーメッセージがコードベースのどこかに現れるか確認
- リファクタリング前に影響を測るためにパターンの出現回数を数える
- 検索をファイルタイプ (`type: "ts"`) や glob (`glob: "**/*.tsx"`) に絞り込む
- `multiline: true` でマルチライン構造体定義や JSX ブロックなどの複数行マッチを取得

## パラメータ

- `pattern` (string, required): 検索する正規表現。ripgrep 構文を使用するため、リテラルな中括弧はエスケープが必要です (例えば `interface{}` を見つけるには `interface\{\}`)。
- `path` (string, optional): 検索するファイルまたはディレクトリ。デフォルトは現在の作業ディレクトリ。
- `glob` (string, optional): `*.js` や `*.{ts,tsx}` などのファイル名フィルタ。
- `type` (string, optional): `js`、`py`、`rust`、`go` などのファイルタイプショートカット。標準言語には `glob` より効率的です。
- `output_mode` (enum, optional): `files_with_matches` (デフォルト、パスのみ返す)、`content` (マッチ行を返す)、`count` (マッチ集計を返す)。
- `-i` (boolean, optional): 大文字小文字を区別しないマッチ。
- `-n` (boolean, optional): `content` モードで行番号を含める。デフォルトは `true`。
- `-A` (number, optional): 各マッチの後に表示するコンテキスト行数 (`content` モードが必要)。
- `-B` (number, optional): 各マッチの前のコンテキスト行数 (`content` モードが必要)。
- `-C` / `context` (number, optional): 各マッチの両側のコンテキスト行数。
- `multiline` (boolean, optional): パターンが改行をまたぐことを許可する (`.` が `\n` にマッチ)。デフォルトは `false`。
- `head_limit` (number, optional): 返される行、ファイルパス、カウントエントリを制限。デフォルトは 250。無制限には `0` を渡します (控えめに使用)。
- `offset` (number, optional): `head_limit` を適用する前に最初の N 件の結果をスキップ。デフォルトは `0`。

## 例

### 例 1: 関数のすべての呼び出し箇所を検索
`pattern: "registerHandler\\("`、`output_mode: "content"`、`-C: 2` を設定して、各呼び出しの周囲の行を表示します。

### 例 2: 型全体のマッチを数える
`pattern: "TODO"`、`type: "py"`、`output_mode: "count"` を設定し、Python ソース全体のファイル別 TODO 合計を表示します。

### 例 3: マルチライン構造体マッチ
`multiline: true` とともに `pattern: "struct Config \\{[\\s\\S]*?version"` を使用して、Go 構造体の数行内に宣言されたフィールドをキャプチャします。

## 注意事項

- `Bash` で `grep` や `rg` を実行するよりも常に `Grep` を優先してください。ツールは正しい権限と構造化出力のために最適化されています。
- デフォルトの出力モードは `files_with_matches` で、最も安価です。行自体を見る必要がある場合にのみ `content` に切り替えてください。
- コンテキストフラグ (`-A`、`-B`、`-C`) は、`output_mode` が `content` でない限り無視されます。
- 大きな結果セットはコンテキストトークンを消費します。焦点を保つには `head_limit`、`offset`、またはより厳密な `glob`/`type` フィルタを使用してください。
- ファイル名の発見には代わりに `Glob` を使用してください。複数ラウンドにわたるオープンエンドな調査には、Explore エージェントで `Agent` を派遣してください。
