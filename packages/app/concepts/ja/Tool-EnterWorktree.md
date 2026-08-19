# EnterWorktree

新しいブランチで分離された Git worktree を作成するか、現在のリポジトリの既存の worktree にセッションを切り替えます。これにより、並列作業や実験的な作業を、プライマリのチェックアウトに触れずに進めることができます。

## 使用タイミング

- ユーザーが明示的に「worktree」と言った場合 — 例えば「worktree を開始して」、「worktree を作成して」、「worktree で作業して」。
- `CLAUDE.md` やメモリの永続的なプロジェクト指示が、現在のタスクに worktree を使用するよう指示している場合。
- 以前に worktree としてセットアップされたタスクを継続したい場合 (`path` を渡して再度入る)。
- 複数の実験的ブランチが常にチェックアウトを切り替えることなくディスク上で共存する必要がある場合。
- 長時間実行タスクを、メインの作業ツリーの無関係な編集から隔離する必要がある場合。

## パラメータ

- `name` (string, optional): 新しい worktree ディレクトリの名前。`/` で区切られた各セグメントは文字、数字、ドット、アンダースコア、ダッシュのみを含むことができます。文字列全体は 64 文字が上限です。省略し、`path` も省略された場合、ランダムな名前が生成されます。`path` と相互に排他的です。
- `path` (string, optional): セッションを切り替える、現在のリポジトリの既存 worktree のファイルシステムパス。このリポジトリの `git worktree list` に表示されている必要があります。現在のリポジトリの登録された worktree でないパスは拒否されます。`name` と相互に排他的です。

## 例

### 例 1: 説明的な名前で新しい worktree を作成

```
EnterWorktree(name="feat/okta-sso")
```

`HEAD` に基づく新しいブランチで `.claude/worktrees/feat/okta-sso` を作成し、セッションの作業ディレクトリをその中に切り替えます。以降のすべてのファイル編集とシェルコマンドは、終了するまでその worktree 内で動作します。

### 例 2: 既存の worktree に再度入る

```
EnterWorktree(path="/Users/me/repo/.claude/worktrees/feat/okta-sso")
```

以前に作成した worktree で作業を再開します。`path` で入ったため、`ExitWorktree` は自動的に削除しません — `action: "keep"` で終了すると元のディレクトリに戻るだけです。

## 注意事項

- ユーザーが明示的に要求するか、プロジェクト指示が要求しない限り `EnterWorktree` を呼び出さないでください。通常のブランチ切り替えやバグ修正リクエストは worktree ではなく通常の Git コマンドを使用してください。
- Git リポジトリ内で呼び出されると、ツールは `.claude/worktrees/` の下に worktree を作成し、`HEAD` に基づく新しいブランチを登録します。Git リポジトリの外では、VCS 非依存の分離のため、`settings.json` で設定された `WorktreeCreate` / `WorktreeRemove` フックに委譲します。
- 一度にアクティブになる worktree セッションは 1 つだけです。すでに worktree セッション内にいる場合、ツールは実行を拒否します。まず `ExitWorktree` で終了してください。
- セッション中に終了するには `ExitWorktree` を使用してください。新しく作成された worktree 内にいる状態でセッションが終了すると、ユーザーに保持するか削除するかのプロンプトが表示されます。
- `path` で入った worktree は外部と見なされます — `ExitWorktree` の `action: "remove"` では削除されません。これはユーザーが手動で管理する worktree を保護する安全装置です。
- 新しい worktree は現在のブランチの内容を継承しますが、独立した作業ディレクトリとインデックスを持ちます。メインチェックアウトのステージング済みおよびステージング前の変更は worktree 内では見えません。
- 命名のヒント: 作業の種類 (`feat/`、`fix/`、`spike/`) をプレフィックスに付けると、複数の同時 worktree が `git worktree list` で区別しやすくなります。
