# Cache Rebuild（キャッシュ再構築）

## 背景

Anthropic の prompt caching メカニズムは、リクエスト内の system → tools → messages（キャッシュブレークポイントまで）を順番に連結してキャッシュキーを生成します。キャッシュキーが前回のリクエストと完全に一致する場合、API は `cache_read_input_tokens`（キャッシュヒット）を返します。キャッシュキーが変更された場合、API はキャッシュを再作成し、大量の `cache_creation_input_tokens` を返します。これがキャッシュ再構築です。

キャッシュ再構築は追加のトークン課金を意味します（cache creation の価格は cache read より高い）。そのため、再構築の原因を特定することはコスト最適化に直接的な価値があります。

## キャッシュ再構築の原因分類

cc-viewer は前後2つの MainAgent リクエストの body を比較し、キャッシュ再構築の原因を正確に判定します：

| reason | 意味 | 判定方法 |
|--------|------|----------|
| `ttl` | キャッシュ期限切れ | 前の MainAgent リクエストから5分以上経過 |
| `system_change` | system prompt の変更 | `JSON.stringify(prev.system) !== JSON.stringify(curr.system)` |
| `tools_change` | ツール定義の変更 | `JSON.stringify(prev.tools) !== JSON.stringify(curr.tools)` |
| `model_change` | モデル切り替え | `prev.model !== curr.model` |
| `msg_truncated` | メッセージスタックの切り詰め | 現在のリクエストの messages 数が前回より少ない。通常コンテキストウィンドウのオーバーフローによる切り詰めで発生 |
| `msg_modified` | 履歴メッセージの変更 | プレフィックスメッセージの内容が不一致（通常の追記時はプレフィックスが完全に同一であるべき） |
| `key_change` | 不明なキー変更 | 上記のいずれにも該当しない場合のフォールバック |

## 判定優先順位

1. まず時間間隔を確認——5分を超えた場合は直接 `ttl` と判定し、body 比較は行わない
2. 次に model、system、tools、messages を順に確認
3. 1つのリクエストが複数の原因に同時に該当する場合がある（例：モデル切り替え + system prompt 変更）。この場合 `reasons` 配列にすべての該当項目が含まれ、tooltip では改行表示される

## よくあるシナリオ

- **`ttl`**：ユーザーが5分以上操作を中断した後に再開し、キャッシュが自然に期限切れ
- **`system_change`**：Claude Code が system prompt を更新（新しい CLAUDE.md の読み込み、project instructions の変更など）
- **`tools_change`**：MCP server の接続/切断により利用可能なツールリストが変化
- **`model_change`**：ユーザーが `/model` コマンドでモデルを切り替え
- **`msg_truncated`**：会話が長くなりコンテキストウィンドウ管理が発動、Claude Code が初期のメッセージを切り詰め
- **`msg_modified`**：Claude Code が履歴メッセージを編集（例：`/compact` で圧縮サマリーが元のメッセージを置換）
