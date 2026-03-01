# Glob

## 定義

高速なファイル名パターンマッチングツール。任意の規模のコードベースに対応。修正時間順にソートされたマッチするファイルパスを返します。

## パラメータ

| パラメータ | 型 | 必須 | 説明 |
|------------|------|------|------|
| `pattern` | string | はい | glob パターン（例：`**/*.js`、`src/**/*.ts`） |
| `path` | string | いいえ | 検索ディレクトリ、デフォルトは現在の作業ディレクトリ。"undefined" や "null" を渡さないこと |

## 使用シナリオ

**適している場合：**
- ファイル名パターンでファイルを検索
- 特定タイプのすべてのファイルを検索（例：すべての `.tsx` ファイル）
- 特定のクラス定義（例：`class Foo`）を探す際にまずファイルを特定
- 単一メッセージ内で複数の Glob 呼び出しを並列実行可能

**適していない場合：**
- ファイル内容の検索——Grep を使用すべき
- 複数ラウンドの検索が必要なオープンエンドな探索——Task（Explore タイプ）を使用すべき

## 注意事項

- 標準 glob 構文をサポート：`*` は単一階層、`**` は複数階層、`{}` は複数選択にマッチ
- 結果は修正時間順にソート
- Bash の `find` コマンドよりも推奨

## cc-viewer での意義

Glob 呼び出しはリクエストログで `tool_use` / `tool_result` content block ペアとして表示されます。`tool_result` にはマッチしたファイルパスのリストが含まれます。

## 原文

<textarea readonly>- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead
- You can call multiple tools in a single response. It is always better to speculatively perform multiple searches in parallel if they are potentially useful.</textarea>
