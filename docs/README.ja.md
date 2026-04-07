# CC-Viewer

Claude Code リクエスト監視システム。Claude Code のすべての API リクエストとレスポンスをリアルタイムでキャプチャし、可視化表示します（原文のまま、省略なし）。開発者が自身の Context を監視し、Vibe Coding 中の振り返りや問題調査に役立てることができます。
最新版の CC-Viewer では、サーバーデプロイによる Web プログラミング環境や、モバイル端末でのプログラミングツールも提供しています。ぜひご自身のプロジェクトでご活用ください。今後さらに多くのプラグイン機能やクラウドデプロイのサポートも予定しています。

まずは面白い部分をご覧ください。モバイルではこのように表示されます：

<img width="1700" height="790" alt="image" src="https://github.com/user-attachments/assets/da3e519f-ff66-4cd2-81d1-f4e131215f6c" />

[English](../README.md) | [简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | 日本語 | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## 使い方

### インストール

```bash
npm install -g cc-viewer --registry=https://registry.npmjs.org
```

### プログラミングモード

ccv は claude のドロップイン代替品です。すべての引数がそのまま claude に渡され、同時に Web Viewer が起動します。

```bash
ccv                    # == claude（対話モード）
ccv -c                 # == claude --continue（前回の会話を続ける）
ccv -r                 # == claude --resume（会話を復元）
ccv -p "hello"         # == claude --print "hello"（出力モード）
ccv --d                # == claude --dangerously-skip-permissions（ショートカット）
ccv --model opus       # == claude --model opus
```

著者がよく使うコマンドは以下の通りです：
```
ccv -c --d             # == claude --continue --dangerously-skip-permissions
```

プログラミングモードで起動すると、Web ページが自動的に開きます。

Web ページ上で Claude を直接使用しながら、完全なリクエストペイロードやコード変更を確認できます。

さらにクールなことに、モバイル端末からプログラミングすることもできます！


### ロガーモード

⚠️ 引き続き claude のネイティブツールや VS Code 拡張機能を使いたい場合は、このモードをご利用ください。

このモードで ```claude``` または ```claude --dangerously-skip-permissions``` を起動すると、

自動的にロギングプロセスが開始され、リクエストログが ~/.claude/cc-viewer/*yourproject*/date.jsonl に記録されます。

ロガーモードの有効化：
```bash
ccv -logger
```

コンソールで具体的なポートが表示できない場合、デフォルトの最初のポートは 127.0.0.1:7008 です。複数のインスタンスがある場合は 7009、7010 のように順次割り当てられます。

このコマンドはローカルの Claude Code のインストール方法（NPM または Native Install）を自動検出し、適切に適応します。

- **NPM 版 Claude Code**：Claude Code の `cli.js` にインターセプトスクリプトを自動的に注入します。
- **Native 版 Claude Code**：`claude` バイナリを自動検出し、ローカル透過プロキシを設定し、Zsh Shell Hook でトラフィックを自動転送します。
- 本プロジェクトでは npm でインストールした Claude Code を推奨しています。

ロガーモードのアンインストール：
```bash
ccv --uninstall
```

### トラブルシューティング

起動できない問題が発生した場合、究極の解決方法があります：
ステップ 1：任意のディレクトリで Claude Code を開きます。
ステップ 2：Claude Code に以下の指示を出します：
```
cc-viewer npm パッケージをインストールしましたが、ccv を実行しても正常に動作しません。cc-viewer の cli.js と findcc.js を確認し、具体的な環境に基づいてローカルの Claude Code のデプロイ方式に適応させてください。変更範囲はできるだけ findcc.js 内に限定してください。
```
Claude Code に自身でエラーを診断させることは、誰かに聞いたりどんなドキュメントを読んだりするよりも効果的です！

上記の指示が完了すると、findcc.js が更新されます。プロジェクトで頻繁にローカルデプロイが必要な場合、または fork したコードでインストール問題を頻繁に解決する必要がある場合、このファイルを保持しておけば次回そのままコピーできます。現段階では、多くのプロジェクトや企業が Claude Code を Mac ではなくサーバーサイドのホスティング環境でデプロイしているため、著者は findcc.js を分離して cc-viewer のソースコード更新を追跡しやすくしました。

### その他の補助コマンド

参照：
```bash
ccv -h
```

### 設定オーバーライド (Configuration Override)

カスタム API エンドポイント（例：企業プロキシ）を使用する必要がある場合は、`~/.claude/settings.json` で設定するか、`ANTHROPIC_BASE_URL` 環境変数を設定するだけです。`ccv` が自動的に認識し、正しくリクエストを転送します。

### サイレントモード (Silent Mode)

デフォルトでは、`ccv` は `claude` をラップして実行する際にサイレントモードで動作し、ターミナル出力をクリーンに保ちネイティブ体験と一致させます。すべてのログはバックグラウンドでキャプチャされ、`http://localhost:7008` で確認できます。

設定完了後は、通常通り `claude` コマンドを使用してください。`http://localhost:7008` にアクセスして監視インターフェースを確認できます。


## クライアント版

cc-viewerにはクライアント版が用意されており、GitHubから対応するクライアント版をダウンロードできます。
[ダウンロードはこちら](https://github.com/weiesky/cc-viewer/releases)
現在クライアント版はテスト段階にあり、問題があればいつでもフィードバックをお寄せください。なお、cc-viewerの使用前提としてローカルにClaude Codeがインストールされている必要があります。
注意すべき点は、cc-viewerはあくまで作業者（Claude Code）の「衣服」に過ぎないということです。Claude Codeがなければ、衣服だけでは独立して機能しません。

## 機能


### プログラミングモード

ccv で起動後に表示される画面：

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/ab353a2b-f101-409d-a28c-6a4e41571ea2" />


編集完了後、コード diff を直接確認できます：

<img width="1500" height="728" alt="image" src="https://github.com/user-attachments/assets/2a4acdaa-fc5f-4dc0-9e5f-f3273f0849b2" />

ファイルを開いて手動でコーディングすることもできますが、手動コーディングは推奨しません。それは古のコーディングです！

### モバイルプログラミング

QR コードをスキャンして、モバイル端末でプログラミングすることもできます：

<img width="3018" height="1460" alt="image" src="https://github.com/user-attachments/assets/8debf48e-daec-420c-b37a-609f8b81cd20" />

モバイルプログラミングの想像を現実に。また、プラグイン機構もあります。自分のコーディング習慣に合わせてカスタマイズが必要な場合は、今後のプラグイン hooks の更新にご期待ください。

### ロガーモード（Claude Code 完全セッションの表示）

<img width="1500" height="768" alt="image" src="https://github.com/user-attachments/assets/a8a9f3f7-d876-4f6b-a64d-f323a05c4d21" />


- Claude Code が送信するすべての API リクエストをリアルタイムでキャプチャし、削除されていない原文を保証します（これは非常に重要です！！！）
- Main Agent と Sub Agent のリクエストを自動的に識別・ラベル付けします（サブタイプ：Plan、Search、Bash）
- MainAgent リクエストで Body Diff JSON をサポートし、前回の MainAgent リクエストとの差分を折りたたみ表示します（変更/追加フィールドのみ表示）
- 各リクエストに Token 使用量統計をインラインで表示します（入力/出力 Token、キャッシュ作成/読み取り、ヒット率）
- Claude Code Router（CCR）およびその他のプロキシシナリオと互換性があります — API パスパターンマッチングでフォールバック

### 会話モード

右上の「会話モード」ボタンをクリックすると、Main Agent の完全な会話履歴をチャットインターフェースとして解析します：

<img width="1500" height="764" alt="image" src="https://github.com/user-attachments/assets/725b57c8-6128-4225-b157-7dba2738b1c6" />


- Agent Team の表示はまだサポートされていません
- ユーザーメッセージは右寄せ（青い吹き出し）、Main Agent の返信は左寄せ（暗い吹き出し）
- `thinking` ブロックはデフォルトで折りたたまれ、Markdown でレンダリングされます。クリックで展開して思考プロセスを確認できます。ワンクリック翻訳をサポートしています（機能はまだ不安定です）
- ユーザー選択型メッセージ（AskUserQuestion）は Q&A 形式で表示されます
- 双方向モード同期：会話モードに切り替えると選択したリクエストに対応する会話に自動スクロール、原文モードに戻ると選択したリクエストに自動スクロール
- 設定パネル：ツール結果と思考ブロックのデフォルト折りたたみ状態を切り替えられます
- モバイル会話ブラウジング：モバイル CLI モードでトップバーの「会話ブラウズ」ボタンをタップすると、読み取り専用の会話ビューがスライド表示され、モバイルで完全な会話履歴を閲覧できます

### 統計ツール

ヘッダー領域の「データ統計」フローティングパネル：

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/a3d2db47-eac3-463a-9b44-3fa64994bf3b" />

- cache creation/read の数量およびキャッシュヒット率を表示
- キャッシュ再構築統計：理由別にグループ化（TTL、system/tools/model の変更、メッセージの切り詰め/変更、key の変更）して回数と cache_creation tokens を表示
- ツール使用統計：呼び出し回数順に各ツールの呼び出し頻度を表示
- Skill 使用統計：呼び出し回数順に各 Skill の呼び出し頻度を表示
- teammate の統計をサポート
- コンセプトヘルプ (?) アイコン：クリックで MainAgent、CacheRebuild、各ツールの組み込みドキュメントを確認できます

### ログ管理

左上の CC-Viewer ドロップダウンメニューから：
<img width="1500" height="760" alt="image" src="https://github.com/user-attachments/assets/33295e2b-f2e0-4968-a6f1-6f3d1404454e" />

**ログの圧縮**
ログについて、著者は Anthropic の公式定義を変更していないことを保証し、ログの完全性を確保しています。
ただし、1M の Opus が後半に生成する単一ログエントリは非常に大きくなるため、著者が MainAgent に対して行ったいくつかのログ最適化により、gzip なしでも少なくとも 66% のサイズ削減を実現しています。
この圧縮ログの解析方法は、現在のリポジトリから抽出できます。

### その他の便利な機能

<img width="1500" height="767" alt="image" src="https://github.com/user-attachments/assets/add558c5-9c4d-468a-ac6f-d8d64759fdbd" />

サイドバーツールを使って、プロンプトを素早く見つけることができます。

--- 

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/82b8eb67-82f5-41b1-89d6-341c95a047ed" />

興味深い KV-Cache-Text 機能で、Claude が見ているものを正確に確認できます。

---

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/54cdfa4e-677c-4aed-a5bb-5fd946600c46" />

画像をアップロードして要望を伝えることができます。Claude の画像理解能力は非常に強力です。また、ご存知の通り、スクリーンショットを Ctrl+V で直接貼り付けることができ、会話中に完全な内容が表示されます。

---

<img width="600" height="370" alt="image" src="https://github.com/user-attachments/assets/87d332ea-3e34-4957-b442-f9d070211fbf" />

プラグインを直接カスタマイズし、CC-Viewer のすべてのプロセスを管理できます。また、CC-Viewer はサードパーティ API へのホットスイッチング機能を備えています（はい、GLM、Kimi、MiniMax、Qwen、DeepSeek を使用できます。著者は現時点ではすべてかなり弱いと考えていますが）。

---


<img width="1500" height="746" alt="image" src="https://github.com/user-attachments/assets/b1f60c7c-1438-4ecc-8c64-193d21ee3445" />

さらに多くの機能があなたを待っています...例えば：本システムは Agent Team をサポートし、Code Reviewer を内蔵しています。Codex の Code Reviewer 統合もまもなく対応予定です（著者は Codex を使って Claude Code のコードをレビューすることを強く推奨しています）。


### 自動更新

CC-Viewer は起動時に自動的に更新を確認します（最大 4 時間に 1 回）。同一メジャーバージョン内（例：1.x.x -> 1.y.z）では自動更新され、次回起動時に適用されます。メジャーバージョンをまたぐ更新は通知のみ表示されます。

自動更新は Claude Code のグローバル設定 `~/.claude/settings.json` に従います。Claude Code で自動更新が無効化されている場合（`autoUpdates: false`）、CC-Viewer も自動更新をスキップします。

### 多言語サポート

CC-Viewer は 18 言語をサポートし、システムロケールに基づいて自動的に切り替わります：

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
