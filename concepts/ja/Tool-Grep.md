# Grep

## 定義

ripgrep ベースの強力なコンテンツ検索ツール。正規表現、ファイルタイプフィルタリング、複数の出力モードに対応。

## パラメータ

| パラメータ | 型 | 必須 | 説明 |
|------------|------|------|------|
| `pattern` | string | はい | 正規表現検索パターン |
| `path` | string | いいえ | 検索パス（ファイルまたはディレクトリ）、デフォルトは現在の作業ディレクトリ |
| `glob` | string | いいえ | ファイル名フィルタ（例：`*.js`、`*.{ts,tsx}`） |
| `type` | string | いいえ | ファイルタイプフィルタ（例：`js`、`py`、`rust`）、glob より効率的 |
| `output_mode` | enum | いいえ | 出力モード：`files_with_matches`（デフォルト）、`content`、`count` |
| `-i` | boolean | いいえ | 大文字小文字を区別しない検索 |
| `-n` | boolean | いいえ | 行番号を表示（content モードのみ）、デフォルト true |
| `-A` | number | いいえ | マッチ後に表示する行数 |
| `-B` | number | いいえ | マッチ前に表示する行数 |
| `-C` / `context` | number | いいえ | マッチ前後に表示する行数 |
| `head_limit` | number | いいえ | 出力エントリ数の制限、デフォルト 0（無制限） |
| `offset` | number | いいえ | 最初の N 件の結果をスキップ |
| `multiline` | boolean | いいえ | 複数行マッチモードを有効化、デフォルト false |

## 使用シナリオ

**適している場合：**
- コードベース内で特定の文字列やパターンを検索
- 関数/変数の使用箇所を検索
- ファイルタイプで検索結果をフィルタリング
- マッチ数のカウント

**適していない場合：**
- ファイル名でファイルを検索——Glob を使用すべき
- 複数ラウンドの検索が必要なオープンエンドな探索——Task（Explore タイプ）を使用すべき

## 注意事項

- ripgrep 構文を使用（grep ではない）、波括弧などの特殊文字はエスケープが必要
- `files_with_matches` モードはファイルパスのみを返し、最も効率的
- `content` モードはマッチ行の内容を返し、コンテキスト行に対応
- 複数行マッチには `multiline: true` の設定が必要
- Bash 内の `grep` や `rg` コマンドよりも常に Grep ツールを優先使用

## cc-viewer での意義

Grep 呼び出しはリクエストログで `tool_use` / `tool_result` content block ペアとして表示されます。`tool_result` には検索結果が含まれます。

## 原文

<textarea readonly>A powerful search tool built on ripgrep

  Usage:
  - ALWAYS use Grep for search tasks. NEVER invoke `grep` or `rg` as a Bash command. The Grep tool has been optimized for correct permissions and access.
  - Supports full regex syntax (e.g., "log.*Error", "function\s+\w+")
  - Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")
  - Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts
  - Use Agent tool for open-ended searches requiring multiple rounds
  - Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping (use `interface\{\}` to find `interface{}` in Go code)
  - Multiline matching: By default patterns match within single lines only. For cross-line patterns like `struct \{[\s\S]*?field`, use `multiline: true`
</textarea>
