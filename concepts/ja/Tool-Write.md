# Write

## 定義

ローカルファイルシステムにコンテンツを書き込みます。ファイルが既に存在する場合は上書きします。

## パラメータ

| パラメータ | 型 | 必須 | 説明 |
|------------|------|------|------|
| `file_path` | string | はい | ファイルの絶対パス（絶対パスでなければならない） |
| `content` | string | はい | 書き込む内容 |

## 使用シナリオ

**適している場合：**
- 新規ファイルの作成
- ファイル内容を完全に書き換える必要がある場合

**適していない場合：**
- ファイル内の部分的な内容の変更——Edit を使用すべき
- ドキュメントファイル（*.md）や README を自発的に作成すべきではない。ユーザーが明示的に要求した場合を除く

## 注意事項

- 対象ファイルが既に存在する場合、先に Read で読み取る必要がある。そうでないと失敗する
- 既存ファイルの全内容を上書きする
- 既存ファイルの編集には Edit を優先使用し、Write は新規ファイル作成または完全な書き換えにのみ使用

## cc-viewer での意義

Write 呼び出しはリクエストログで `tool_use` content block として表示され、その `input.content` に書き込まれた完全な内容が含まれます。

## 原文

<textarea readonly>Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.</textarea>
