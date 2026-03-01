# Edit

## 定義

精確な文字列置換によるファイル編集。ファイル内の `old_string` を `new_string` に置換します。

## パラメータ

| パラメータ | 型 | 必須 | 説明 |
|------------|------|------|------|
| `file_path` | string | はい | 変更するファイルの絶対パス |
| `old_string` | string | はい | 置換する元のテキスト |
| `new_string` | string | はい | 置換後の新しいテキスト（old_string と異なる必要がある） |
| `replace_all` | boolean | いいえ | すべてのマッチを置換するかどうか、デフォルト `false` |

## 使用シナリオ

**適している場合：**
- 既存ファイル内の特定のコードセクションを変更
- バグ修正、ロジックの更新
- 変数のリネーム（`replace_all: true` と併用）
- ファイル内容を精確に変更する必要があるすべてのシナリオ

**適していない場合：**
- 新規ファイルの作成——Write を使用すべき
- 大規模な書き換え——Write でファイル全体を上書きする必要がある場合

## 注意事項

- 使用前に必ず Read でそのファイルを読み取っておく必要がある。そうでないとエラーになる
- `old_string` はファイル内で一意でなければならない。一意でない場合は、より多くのコンテキストを含めて一意にするか、`replace_all` を使用する
- テキスト編集時は元のインデント（tab/スペース）を維持する必要がある。Read 出力の行番号プレフィックスを含めないこと
- 新規ファイル作成よりも既存ファイルの編集を優先
- `new_string` は `old_string` と異なる必要がある

## cc-viewer での意義

Edit 呼び出しはリクエストログで `tool_use` content block として表示され、その `input` に `old_string` と `new_string` が含まれます。モデルがファイルに対して行った変更を追跡するのに使用できます。

## 原文

<textarea readonly>Performs exact string replacements in files.

Usage:
- You must use your `Read` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file. 
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if `old_string` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use `replace_all` to change every instance of `old_string`.
- Use `replace_all` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.</textarea>
