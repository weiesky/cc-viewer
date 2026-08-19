# Teammate

## 定義

Teammate は Claude Code Agent Team モードにおける協調 agent です。メイン agent が `TeamCreate` でチームを作成し、`Agent` ツールで teammate を生成すると、各 teammate は独立した agent プロセスとして実行され、独自のコンテキストウィンドウとツールセットを持ち、`SendMessage` を通じてチームメンバーと通信します。

## SubAgent との違い

| 特徴 | Teammate | SubAgent |
|------|----------|----------|
| ライフサイクル | 持続的に存在し、複数回メッセージを受信可能 | 一回限りのタスク、完了後に破棄 |
| 通信方式 | SendMessage による双方向メッセージ | 親→子の一方向呼び出し、結果を返す |
| コンテキスト | 独立した完全なコンテキスト、ターン間で保持 | 隔離されたタスクコンテキスト |
| 協調モデル | チーム協調、相互通信可能 | 階層構造、親 agent とのみやり取り |
| タスクタイプ | 複雑なマルチステップタスク | 検索・探索などの単一タスク |

## 動作

- メイン agent（team lead）が `Agent` ツールで作成し、`team_name` を割り当てる
- `TaskList` / `TaskGet` / `TaskUpdate` を通じてタスクリストを共有
- 各ターンの実行完了後に idle 状態に入り、新しいメッセージで起動を待つ
- `shutdown_request` により graceful に終了可能

## 統計パネルの説明

Teammate 統計パネルは各 teammate の API 呼び出し回数を表示します。`Name` 列は teammate 名（例：`reviewer-security`、`reviewer-pipeline`）、`回数` 列はその teammate が発生させた API リクエストの総数です。
