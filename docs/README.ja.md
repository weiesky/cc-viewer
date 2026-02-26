# CC-Viewer

Claude Code リクエスト監視システム。Claude Code のすべての API リクエストとレスポンスをリアルタイムでキャプチャし、視覚化します。Vibe Coding 中に Context を監視し、レビューやデバッグに役立ちます。

[简体中文](./README.zh.md) | [English](../README.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## 使用方法

```bash
npm install -g cc-viewer
```

### 実行と自動設定

```bash
ccv
```

このコマンドは、ローカルにインストールされた Claude Code のインストール方法（NPM または Native Install）を自動的に検出し、適応させます。

- **NPM Install**: Claude Code の `cli.js` にインターセプトスクリプトを自動的に注入します。
- **Native Install**: `claude` バイナリを自動的に検出し、ローカル透過プロキシを設定し、Zsh Shell Hook を設定してトラフィックを自動的に転送します。

### 設定の上書き (Configuration Override)

カスタム API エンドポイント（企業のプロキシなど）を使用する必要がある場合は、`~/.claude/settings.json` で設定するか、`ANTHROPIC_BASE_URL` 環境変数を設定するだけです。`ccv` はこれらの設定を自動的に認識し、リクエストを正しく転送します。

### サイレントモード (Silent Mode)

デフォルトでは、`ccv` は `claude` をラップして実行する際にサイレントモードになり、ターミナル出力がクリーンに保たれ、オリジナルの Claude Code 体験と変わらないようにします。すべてのログはバックグラウンドでキャプチャされ、`http://localhost:7008` で確認できます。

設定完了後、通常通り `claude` コマンドを使用してください。`http://localhost:7008` にアクセスして監視インターフェースを確認できます。

### トラブルシューティング (Troubleshooting)

- **出力の混在 (Mixed Output)**: `[CC-Viewer]` のデバッグログが Claude の出力と混ざって表示される場合は、最新バージョンに更新してください (`npm install -g cc-viewer`)。
- **接続拒否 (Connection Refused)**: `ccv` バックグラウンドプロセスが実行されていることを確認してください。`ccv` または `claude`（フックインストール後）を実行すると自動的に起動するはずです。
- **ボディなし (Empty Body)**: Viewer で "No Body" と表示される場合は、非標準の SSE 形式が原因の可能性があります。Viewer は現在、フォールバックとして生コンテンツのキャプチャをサポートしています。

### バージョン確認 (Check Version)

```bash
ccv --version
```

### アンインストール

```bash
ccv --uninstall
```

## 機能

### リクエスト監視（Raw モード）

- Claude Code からのすべての API リクエストをリアルタイムキャプチャ（ストリーミングレスポンス含む）
- 左パネルにリクエストメソッド、URL、所要時間、ステータスコードを表示
- Main Agent と Sub Agent リクエストを自動識別・ラベリング（サブタイプ：Bash、Task、Plan、General）
- リクエストリストが選択項目に自動スクロール（モード切替時は中央表示、手動クリック時は最寄りにスクロール）
- 右パネルで Request / Response タブ切り替え対応
- Request Body の `messages`、`system`、`tools` はデフォルトで1階層展開
- Response Body はデフォルトで全展開
- JSON ビューとプレーンテキストビューの切り替え対応
- JSON コンテンツのワンクリックコピー
- MainAgent リクエストで Body Diff JSON をサポート、前回の MainAgent リクエストとの差分を折りたたみ表示（変更/追加フィールドのみ）
- Diff セクションは JSON/テキストビューの切り替えおよびワンクリックコピーに対応
- 「Diff を展開」設定：有効にすると、MainAgent リクエストで Diff セクションが自動展開されます
- Body Diff JSON ツールチップは閉じることができ、閉じるとサーバー側に設定が保存され、再表示されません
- 機密ヘッダー（`x-api-key`、`authorization`）は JSONL ログファイルで自動的にマスクされ、認証情報の漏洩を防止
- リクエストごとにインラインで Token 使用量統計を表示（入力/出力 Token、キャッシュ作成/読み取り、ヒット率）
- Claude Code Router（CCR）およびその他のプロキシ環境に対応 — APIパスパターンによるフォールバックマッチング

### チャットモード

右上の「チャットモード」ボタンをクリックして、Main Agent の完全な会話履歴をチャットインターフェースに解析：

- ユーザーメッセージ右揃え（青い吹き出し）、Main Agent の返信左揃え（ダークの吹き出し）、Markdown レンダリング対応
- `/compact` メッセージを自動検出し折りたたみ表示、クリックで完全なサマリーを展開
- ツール呼び出し結果が対応する Assistant メッセージ内にインライン表示
- `thinking` ブロックはデフォルトで折りたたみ、Markdown でレンダリング、クリックで展開；ワンクリック翻訳対応
- `tool_use` はコンパクトなツール呼び出しカードとして表示（Bash、Read、Edit、Write、Glob、Grep、Task 等に専用表示）
- Task（SubAgent）ツール結果を Markdown でレンダリング
- ユーザー選択メッセージ（AskUserQuestion）は Q&A 形式で表示
- システムタグ（`<system-reminder>`、`<project-reminder>` 等）自動折りたたみ
- Skill 読み込みメッセージを自動検出して折りたたみ表示、Skill 名を表示；クリックで完全なドキュメントを展開（Markdown レンダリング）
- Skills reminder を自動検出して折りたたみ表示
- システムテキスト自動フィルタリング、実際のユーザー入力のみ表示
- マルチ session 分割表示（`/compact`、`/clear` 等の操作後に自動分割）
- 各メッセージに秒単位の正確なタイムスタンプを表示、API リクエストのタイミングから算出
- 各メッセージに「リクエストを表示」リンクがあり、対応する API リクエストの Raw モードにジャンプ可能
- 双方向モード同期：チャットモードに切り替えると選択中のリクエストに対応する会話にスクロール、Raw モードに戻ると選択中のリクエストにスクロール
- 設定パネル：ツール結果と thinking ブロックのデフォルト折りたたみ状態を切り替え
- グローバル設定：無関係なリクエスト（count_tokens、ハートビート）のフィルタリング切り替え

### 翻訳

- thinking ブロックと Assistant メッセージでワンクリック翻訳に対応
- Claude Haiku API を使用、API Key（`x-api-key`）と OAuth Bearer Token の両方の認証方式に対応
- 翻訳結果は自動キャッシュされ、再度クリックで原文に切り替え
- 翻訳中はローディングスピナーアニメーションを表示

### Token 消費統計

ヘッダー領域のホバーパネル：

- モデル別 input/output token 数量のグループ統計
- Cache creation/read 数量およびキャッシュヒット率の表示
- キャッシュリビルド統計を理由別にグループ表示（TTL 期限切れ、system/tools/model 変更、メッセージ切り詰め/変更、キー変更）、回数および cache_creation トークン数を含む
- ツール使用統計：ツールごとの呼び出し回数を頻度順に表示
- Skill 使用統計：Skill ごとの呼び出し回数を頻度順に表示
- コンセプトヘルプ (?) アイコン：クリックで MainAgent、CacheRebuild、各ツールの内蔵ドキュメントを表示
- Main Agent キャッシュ有効期限カウントダウン

### ログ管理

左上の CC-Viewer ドロップダウンメニュー：

- ローカルログのインポート：プロジェクト別にグループ化された履歴ログファイルを閲覧、新しいウィンドウで開く
- ローカル JSONL ファイルの読み込み：ローカルの `.jsonl` ファイルを直接選択して読み込み（最大 500MB）
- 現在のログをダウンロード：現在監視中の JSONL ログファイルをダウンロード
- ログ結合：複数の JSONL ログファイルを1つのセッションに結合して統合分析
- ユーザー Prompt を表示：すべてのユーザー入力を抽出し、3つの表示モードで表示 — 原文モード（元のコンテンツ）、コンテキストモード（システムタグ折りたたみ可能）、Text モード（プレーンテキスト）；スラッシュコマンド（`/model`、`/context` など）は独立エントリとして表示；コマンド関連タグは Prompt コンテンツから自動非表示
- Prompt を TXT にエクスポート：ユーザー Prompt（テキストのみ、システムタグを除く）をローカルの `.txt` ファイルにエクスポート

### 多言語サポート

CC-Viewer は 18 言語をサポートし、システムロケールに基づいて自動切り替えします：

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
