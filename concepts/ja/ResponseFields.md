# Response Body フィールド説明

Claude API `/v1/messages` レスポンスボディのフィールド説明。

## トップレベルフィールド

| フィールド | 型 | 説明 |
|------|------|------|
| **model** | string | 実際に使用されたモデル名。例: `claude-opus-4-6` |
| **id** | string | 今回のレスポンスの一意識別子。例: `msg_01Tgsr2QeH8AVXGoP2wAXRvU` |
| **type** | string | 固定値 `"message"` |
| **role** | string | 固定値 `"assistant"` |
| **content** | array | モデル出力のコンテンツブロック配列。テキスト、ツール呼び出し、思考プロセスなどを含む |
| **stop_reason** | string | 停止理由: `"end_turn"`（正常終了）、`"tool_use"`（ツール実行が必要）、`"max_tokens"`（トークン上限に到達） |
| **stop_sequence** | string/null | 停止をトリガーしたシーケンス。通常は `null` |
| **usage** | object | トークン使用量の統計（詳細は下記参照） |

## content ブロックタイプ

| タイプ | 説明 |
|------|------|
| **text** | モデルのテキスト応答。`text` フィールドを含む |
| **tool_use** | ツール呼び出しリクエスト。`name`（ツール名）、`input`（パラメータ）、`id`（呼び出し ID、tool_result とのマッチングに使用）を含む |
| **thinking** | 拡張思考の内容（thinking モードが有効な場合のみ出現）。`thinking` フィールドを含む |

## usage フィールド詳細

| フィールド | 説明 |
|------|------|
| **input_tokens** | キャッシュにヒットしなかった入力トークン数（通常料金で課金） |
| **cache_creation_input_tokens** | 今回新たに作成されたキャッシュのトークン数（キャッシュ書き込み、通常入力より高い料金） |
| **cache_read_input_tokens** | キャッシュにヒットしたトークン数（キャッシュ読み取り、通常入力より大幅に低い料金） |
| **output_tokens** | モデル出力のトークン数 |
| **service_tier** | サービスティア。例: `"standard"` |
| **inference_geo** | 推論リージョン。例: `"not_available"` はリージョン情報が提供されていないことを示す |

## cache_creation サブフィールド

| フィールド | 説明 |
|------|------|
| **ephemeral_5m_input_tokens** | TTL 5分の短期キャッシュ作成トークン数 |
| **ephemeral_1h_input_tokens** | TTL 1時間の長期キャッシュ作成トークン数 |

> **キャッシュ課金について**: `cache_read_input_tokens` の単価は `input_tokens` よりはるかに低く、`cache_creation_input_tokens` の単価は通常入力よりやや高くなっています。そのため、継続的な会話で高いキャッシュヒット率を維持することで、費用を大幅に削減できます。cc-viewer の「ヒット率」指標でこの比率を直感的に監視できます。

## stop_reason の意味

- **end_turn**: モデルが正常に応答を完了
- **tool_use**: モデルがツールの呼び出しを必要としており、content に `tool_use` ブロックが含まれる。次のリクエストでは messages に `tool_result` を追加して会話を継続する必要がある
- **max_tokens**: `max_tokens` の制限に達して切り詰められたため、応答が不完全な可能性がある
