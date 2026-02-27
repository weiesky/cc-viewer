# CC-Viewer

Claude Code リクエスト監視システム。Claude Code のすべての API リクエストとレスポンスをリアルタイムでキャプチャし、視覚化します（原文テキスト、削除なし）。開発者が Vibe Coding の過程で自身の Context を監視し、レビューや問題追跡に役立てることができます。

[English](../README.md) | [简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | 日本語 | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## 使用方法

### インストール

```bash
npm install -g cc-viewer
```

### 実行と自動設定

```bash
ccv
```

このコマンドは、ローカルの Claude Code のインストール方法（NPM または Native Install）を自動的に検出し、適応します。

- **NPM インストール**：Claude Code の `cli.js` にインターセプトスクリプトを自動的に注入します。
- **Native Install**：`claude` バイナリを自動的に検出し、ローカル透過プロキシを設定し、Zsh Shell Hook を設定してトラフィックを自動的に転送します。

### 設定の上書き (Configuration Override)

カスタム API エンドポイント（企業プロキシなど）を使用する必要がある場合は、`~/.claude/settings.json` で設定するか、`ANTHROPIC_BASE_URL` 環境変数を設定するだけです。`ccv` は自動的に認識し、リクエストを正しく転送します。

### サイレントモード (Silent Mode)

デフォルトでは、`ccv` は `claude` をラップして実行する際にサイレントモードで動作し、ターミナル出力がクリーンに保たれ、ネイティブ体験と一致するようにします。すべてのログはバックグラウンドでキャプチャされ、`http://localhost:7008` で確認できます。

設定完了後、通常通り `claude` コマンドを使用してください。`http://localhost:7008` にアクセスして監視インターフェースを確認できます。

### トラブルシューティング (Troubleshooting)

起動できない問題が発生した場合、最終的なトラブルシューティング方法があります：
ステップ1：任意のディレクトリで Claude Code を開きます。
ステップ2：Claude Code に以下の内容で指示を出します：
```
cc-viewer という npm パッケージをインストールしましたが、ccv を実行しても正常に動作しません。cc-viewer の cli.js と findcc.js を確認し、具体的な環境に応じてローカルの Claude Code のデプロイ方式に適応してください。適応の際は、変更範囲をできるだけ findcc.js 内に限定してください。
```
Claude Code 自身にエラーを確認させることは、誰かに聞いたりドキュメントを読んだりするよりもはるかに効果的な手段です！

上記の指示が完了すると、findcc.js が更新されます。プロジェクトでローカルデプロイが頻繁に必要な場合、またはフォークしたコードでインストール問題を繰り返し解決する必要がある場合は、このファイルを保持しておけば、次回はそのままコピーして使えます。現在、多くのプロジェクトや企業では Claude Code を Mac ではなくサーバーサイドでホスティングしているため、作者は findcc.js ファイルを分離し、cc-viewer のソースコード更新を追跡しやすくしました。

### アンインストール

```bash
ccv --uninstall
```

### バージョン確認

```bash
ccv --version
```

## 機能

### リクエスト監視（原文モード）
<img width="1500" height="720" alt="image" src="https://github.com/user-attachments/assets/519dd496-68bd-4e76-84d7-2a3d14ae3f61" />
- Claude Code から発信されるすべての API リクエストをリアルタイムでキャプチャし、削除後のログではなく原文であることを保証します（これは非常に重要です！！！）
- Main Agent と Sub Agent リクエストを自動識別・ラベリング（サブタイプ：Bash、Task、Plan、General）
- MainAgent リクエストは Body Diff JSON をサポートし、前回の MainAgent リクエストとの差分を折りたたみ表示（変更/追加フィールドのみ表示）
- 各リクエストにインラインで Token 使用量統計を表示（入力/出力 Token、キャッシュ作成/読み取り、ヒット率）
- Claude Code Router（CCR）およびその他のプロキシ環境に対応 — API パスパターンによるフォールバックマッチング

### 対話モード

右上の「対話モード」ボタンをクリックして、Main Agent の完全な会話履歴をチャットインターフェースに解析：
<img width="1500" height="730" alt="image" src="https://github.com/user-attachments/assets/c973f142-748b-403f-b2b7-31a5d81e33e6" />


- Agent Team の表示はまだサポートされていません
- ユーザーメッセージは右揃え（青い吹き出し）、Main Agent の返信は左揃え（ダークの吹き出し）
- `thinking` ブロックはデフォルトで折りたたみ、Markdown でレンダリング、クリックで思考過程を展開；ワンクリック翻訳対応（機能はまだ不安定）
- ユーザー選択メッセージ（AskUserQuestion）は Q&A 形式で表示
- 双方向モード同期：対話モードに切り替えると選択中のリクエストに対応する会話に自動移動；原文モードに戻ると選択中のリクエストに自動移動
- 設定パネル：ツール結果と thinking ブロックのデフォルト折りたたみ状態を切り替え可能


### 統計ツール

Header 領域の「データ統計」ホバーパネル：
<img width="1500" height="729" alt="image" src="https://github.com/user-attachments/assets/b23f9a81-fc3d-4937-9700-e70d84e4e5ce" />

- cache creation/read 数量およびキャッシュヒット率を表示
- キャッシュリビルド統計：原因別にグループ化（TTL、system/tools/model 変更、メッセージ切り詰め/変更、key 変更）回数と cache_creation tokens を表示
- ツール使用統計：呼び出し回数順に各ツールの呼び出し頻度を表示
- Skill 使用統計：呼び出し回数順に各 Skill の呼び出し頻度を表示
- コンセプトヘルプ (?) アイコン：クリックで MainAgent、CacheRebuild、各ツールの内蔵ドキュメントを表示

### ログ管理

左上の CC-Viewer ドロップダウンメニュー：
<img width="1200" height="672" alt="image" src="https://github.com/user-attachments/assets/8cf24f5b-9450-4790-b781-0cd074cd3b39" />

- ローカルログのインポート：プロジェクト別にグループ化された履歴ログファイルを閲覧、新しいウィンドウで開く
- ローカル JSONL ファイルの読み込み：ローカルの `.jsonl` ファイルを直接選択して読み込み（最大 500MB 対応）
- 現在のログを名前を付けて保存：現在監視中の JSONL ログファイルをダウンロード
- ログ結合：複数の JSONL ログファイルを1つのセッションに結合して統合分析
- ユーザー Prompt を表示：すべてのユーザー入力を抽出し、3つの表示モードで表示 — 原文モード（元のコンテンツ）、コンテキストモード（システムタグ折りたたみ可能）、Text モード（プレーンテキスト）；スラッシュコマンド（`/model`、`/context` など）は独立エントリとして表示；コマンド関連タグは Prompt コンテンツから自動非表示
- Prompt を TXT にエクスポート：ユーザー Prompt（プレーンテキスト、システムタグを除く）をローカルの `.txt` ファイルにエクスポート

### 多言語サポート

CC-Viewer は 18 言語をサポートし、システムロケールに基づいて自動切り替えします：

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
