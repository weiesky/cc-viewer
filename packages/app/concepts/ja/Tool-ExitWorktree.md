# ExitWorktree

`EnterWorktree` によって作成された worktree セッションを終了し、元の作業ディレクトリにセッションを戻します。このツールは現在のセッション内で `EnterWorktree` によって作成された worktree にのみ作用します。アクティブなセッションがない場合は何も行いません。

## 使用タイミング

- 隔離された worktree での作業が完了し、メインの作業ディレクトリに戻りたいとき。
- フィーチャーブランチの worktree でのタスクが完了してマージした後、ブランチとディレクトリを削除したいとき。
- worktree を後で再利用するために保持したまま、何も削除せずに元のディレクトリへ戻りたいとき。
- 実験的または使い捨てのブランチを破棄し、ディスク上にアーティファクトを残したくないとき。
- 新しい `EnterWorktree` セッションを開始する前に、現在のセッションを終了する必要があるとき。

## パラメータ

- `action`（文字列、必須）：`"keep"` は worktree ディレクトリとブランチをディスク上に保持し後で戻れるようにする；`"remove"` は worktree ディレクトリとブランチの両方を削除してクリーンに終了する。
- `discard_changes`（ブール値、省略可能、デフォルト `false`）：`action` が `"remove"` のときのみ意味を持ちます。worktree にコミットされていないファイルや元のブランチにないコミットが存在する場合、`discard_changes` を `true` に設定しない限りツールは削除を拒否します。エラーレスポンスに具体的な変更内容が列挙されるので、再呼び出し前にユーザーに確認できます。

## 例

### 例 1：変更をマージした後のクリーンな終了

worktree での作業を完了してブランチをメインにマージした後、`action: "remove"` を指定して `ExitWorktree` を呼び出すと、worktree ディレクトリとブランチが削除され、元の作業ディレクトリに戻ります。

```
ExitWorktree(action: "remove")
```

### 例 2：未コミットの実験コードがある使い捨て worktree を破棄する

worktree に完全に破棄すべき実験的な未コミットの変更が含まれている場合、まず `action: "remove"` を試みます。ツールは拒否し、未コミットの変更を列挙します。ユーザーに変更を破棄してよいか確認した後、`discard_changes: true` を指定して再呼び出しします。

```
ExitWorktree(action: "remove", discard_changes: true)
```

## 注意事項

- このツールは現在のセッション内で `EnterWorktree` によって作成された worktree にのみ作用します。`git worktree add` で作成した worktree、過去のセッションの worktree、または `EnterWorktree` を呼び出したことがない通常の作業ディレクトリには影響を与えません。これらの場合は何も行いません。
- worktree にコミットされていない変更や元のブランチに存在しないコミットがある場合、`discard_changes: true` を明示的に指定しない限り `action: "remove"` は拒否されます。データは復元できないため、`discard_changes: true` を設定する前に必ずユーザーに確認してください。
- worktree に tmux セッションがアタッチされている場合：`remove` ではそのセッションは終了されます；`keep` ではセッションは実行されたままになり、後でユーザーが再アタッチできるようにセッション名が返されます。
- `ExitWorktree` が完了した後、`EnterWorktree` を再び呼び出して新しい worktree セッションを開始できます。
