# CC-Viewer

Claude Code リクエスト監視システム。Claude Code のすべての API リクエストとレスポンスをリアルタイムでキャプチャし、視覚化します。Vibe Coding 中に Context を監視し、レビューやデバッグに役立ちます。

[简体中文](./README.zh.md) | [English](../README.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## 使用方法

```bash
npm install -g cc-viewer
```

インストール後、実行：

```bash
ccv
```

このコマンドは、ローカルにインストールされた Claude Code を自動的に監視用に設定し、shell 設定ファイル（`~/.zshrc` または `~/.bashrc`）に自動修復 hook を追加します。その後、Claude Code を通常通り使用し、ブラウザで `http://localhost:7008` を開いて監視インターフェースを確認してください。

Claude Code の更新後、手動操作は不要です。次回 `claude` を実行すると、自動的に検出して再設定します。

### アンインストール

```bash
ccv --uninstall
```

## 機能

### リクエスト監視（Raw モード）

- Claude Code からのすべての API リクエストをリアルタイムキャプチャ（ストリーミングレスポンス含む）
- 左パネルにリクエストメソッド、URL、所要時間、ステータスコードを表示
- Main Agent と Sub Agent リクエストを自動識別・ラベリング（サブタイプ：Bash、Task、Plan、General）
- 右パネルで Request / Response タブ切り替え対応
- Request Body の `messages`、`system`、`tools` はデフォルトで1階層展開
- Response Body はデフォルトで全展開
- JSON ビューとプレーンテキストビューの切り替え対応
- JSON コンテンツのワンクリックコピー
- MainAgent リクエストで Body Diff JSON をサポート、前回の MainAgent リクエストとの差分を折りたたみ表示（変更/追加フィールドのみ）
- Body Diff JSON ツールチップは閉じることができ、閉じるとサーバー側に設定が保存され、再表示されません

### チャットモード

右上の「チャットモード」ボタンをクリックして、Main Agent の完全な会話履歴をチャットインターフェースに解析：

- ユーザーメッセージ右揃え（青い吹き出し）、Main Agent の返信左揃え（ダークの吹き出し）、Markdown レンダリング対応
- `/compact` メッセージを自動検出し折りたたみ表示、クリックで完全なサマリーを展開
- ツール呼び出し結果が対応する Assistant メッセージ内にインライン表示
- `thinking` ブロックはデフォルトで折りたたみ、クリックで展開
- `tool_use` はコンパクトなツール呼び出しカードとして表示（Bash、Read、Edit、Write、Glob、Grep、Task 等に専用表示）
- ユーザー選択メッセージ（AskUserQuestion）は Q&A 形式で表示
- システムタグ（`<system-reminder>`、`<project-reminder>` 等）自動折りたたみ
- システムテキスト自動フィルタリング、実際のユーザー入力のみ表示
- マルチ session 分割表示（`/compact`、`/clear` 等の操作後に自動分割）
- 各メッセージに秒単位の正確なタイムスタンプを表示

### Token 消費統計

ヘッダー領域のホバーパネル：

- モデル別 input/output token 数量のグループ統計
- Cache creation/read 数量およびキャッシュヒット率の表示
- Main Agent キャッシュ有効期限カウントダウン

### ログ管理

左上の CC-Viewer ドロップダウンメニュー：

- ローカルログのインポート：プロジェクト別にグループ化された履歴ログファイルを閲覧、新しいウィンドウで開く
- ローカル JSONL ファイルの読み込み：ローカルの `.jsonl` ファイルを直接選択して読み込み（最大 200MB）
- 現在のログをダウンロード：現在監視中の JSONL ログファイルをダウンロード
- ユーザー Prompt のエクスポート：すべてのユーザー入力を抽出・表示、system-reminder 折りたたみ表示対応
- Prompt を TXT にエクスポート：ユーザー Prompt をローカルの `.txt` ファイルにエクスポート

### 多言語サポート

CC-Viewer は 18 言語をサポートし、システムロケールに基づいて自動切り替えします：

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
