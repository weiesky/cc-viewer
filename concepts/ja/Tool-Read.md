# Read

## 定義

ローカルファイルシステムからファイル内容を読み取ります。テキストファイル、画像、PDF、Jupyter notebook に対応。

## パラメータ

| パラメータ | 型 | 必須 | 説明 |
|------------|------|------|------|
| `file_path` | string | はい | ファイルの絶対パス |
| `offset` | number | いいえ | 開始行番号（大きなファイルの分割読み取り用） |
| `limit` | number | いいえ | 読み取り行数（大きなファイルの分割読み取り用） |
| `pages` | string | いいえ | PDF ページ範囲（例："1-5"、"3"、"10-20"）、PDF のみ適用 |

## 使用シナリオ

**適している場合：**
- コードファイル、設定ファイルなどのテキストファイルを読み取り
- 画像ファイルの表示（Claude はマルチモーダルモデル）
- PDF ドキュメントの読み取り
- Jupyter notebook の読み取り（すべてのセルと出力を返す）
- 複数ファイルを並列読み取りしてコンテキストを取得

**適していない場合：**
- ディレクトリの読み取り——Bash の `ls` コマンドを使用すべき
- オープンエンドなコードベース探索——Task（Explore タイプ）を使用すべき

## 注意事項

- パスは絶対パスでなければならず、相対パスは不可
- デフォルトでファイルの最初の 2000 行を読み取り
- 2000 文字を超える行は切り詰められる
- 出力は `cat -n` 形式で、行番号は 1 から開始
- 大きな PDF（10 ページ超）は `pages` パラメータの指定が必須、1回最大 20 ページ
- 存在しないファイルの読み取りはエラーを返す（クラッシュしない）
- 単一メッセージ内で複数の Read を並列呼び出し可能

## cc-viewer での意義

Read 呼び出しはリクエストログで `tool_use`（呼び出し）と `tool_result`（返却内容）の content block ペアとして表示されます。`tool_result` にはファイルの実際の内容が含まれ、モデルがどのファイルを読み取ったかの分析に使用できます。

## 原文

<textarea readonly>Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to 2000 lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters
- Any lines longer than 2000 characters will be truncated
- Results are returned using cat -n format, with line numbers starting at 1
- This tool allows Claude Code to read images (eg PNG, JPG, etc). When reading an image file the contents are presented visually as Claude Code is a multimodal LLM.
- This tool can read PDF files (.pdf). For large PDFs (more than 10 pages), you MUST provide the pages parameter to read specific page ranges (e.g., pages: "1-5"). Reading a large PDF without the pages parameter will fail. Maximum 20 pages per request.
- This tool can read Jupyter notebooks (.ipynb files) and returns all cells with their outputs, combining code, text, and visualizations.
- This tool can only read files, not directories. To read a directory, use an ls command via the Bash tool.
- You can call multiple tools in a single response. It is always better to speculatively read multiple potentially useful files in parallel.
- You will regularly be asked to read screenshots. If the user provides a path to a screenshot, ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.</textarea>
