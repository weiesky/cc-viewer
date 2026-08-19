# Request Body フィールド説明

Claude API `/v1/messages` リクエストボディのトップレベルフィールドの説明。

## フィールド一覧

| フィールド | 型 | 説明 |
|------|------|------|
| **model** | string | 使用するモデル名。例：`claude-opus-4-6`、`claude-sonnet-4-6` |
| **messages** | array | 会話メッセージの履歴。各メッセージには `role`（user/assistant）と `content`（テキスト、画像、tool_use、tool_result などの block 配列）が含まれる |
| **system** | array | System prompt。Claude Code のコア指令、ツール使用説明、環境情報、CLAUDE.md の内容などを含む。`cache_control` 付きのブロックは prompt caching される |
| **tools** | array | 利用可能なツール定義のリスト。各ツールには `name`、`description`、`input_schema`（JSON Schema）が含まれる。MainAgent には通常 20 以上のツールがあり、SubAgent には少数のみ |
| **metadata** | object | リクエストメタデータ。通常、ユーザーを識別するための `user_id` を含む |
| **max_tokens** | number | モデルが一度の応答で生成する最大トークン数。例：`16000`、`64000` |
| **thinking** | object | 拡張思考の設定。`type: "enabled"` で思考モードを有効にし、`budget_tokens` で思考トークンの上限を制御する |
| **context_management** | object | コンテキスト管理の設定。`truncation: "auto"` により、Claude Code は長すぎるメッセージ履歴を自動的に切り詰めることができる |
| **output_config** | object | 出力設定。`format` の設定など |
| **stream** | boolean | ストリーミングレスポンスを有効にするかどうか。Claude Code は常に `true` を使用する |

## messages の構造

各メッセージの `content` は block 配列で、一般的な型は以下の通り：

- **text**: 通常のテキストコンテンツ
- **tool_use**: モデルによるツール呼び出し（`name`、`input` を含む）
- **tool_result**: ツールの実行結果（`tool_use_id`、`content` を含む）
- **image**: 画像コンテンツ（base64 または URL）
- **thinking**: モデルの思考プロセス（拡張思考モード）

## system の構造

system prompt 配列には通常以下が含まれる：

1. **コア agent 指令**（"You are Claude Code..."）
2. **ツール使用規範**
3. **CLAUDE.md の内容**（プロジェクトレベルの指令）
4. **スキルプロンプト**（skills reminder）
5. **環境情報**（OS、shell、git ステータスなど）— 実際のところ、Claude Code は git に大きく依存している。プロジェクトに git リポジトリが存在する場合、Claude Code はリモートの変更やコミット履歴を取得して分析を補助するなど、プロジェクトに対してより優れた理解力を発揮できる

`cache_control: { type: "ephemeral" }` マークが付いたブロックは Anthropic API により 5 分間キャッシュされ、キャッシュヒット時は `cache_read_input_tokens` として課金される（`input_tokens` よりはるかに低い）。

> **注意**：Claude Code のような特殊なクライアントの場合、Anthropic のサーバー側はリクエスト中の `cache_control` 属性に完全に依存してキャッシュ動作を決定しているわけではない。サーバー側は特定のフィールド（system prompt やツール定義など）に対して自動的にキャッシュポリシーを適用しており、リクエストに `cache_control` マークが明示的に含まれていなくても同様である。したがって、リクエストボディにこの属性が見当たらなくても疑問に思う必要はない——サーバー側がバックグラウンドでキャッシュ操作を完了しており、その情報をクライアントに公開していないだけである。これは Claude Code と Anthropic API の間の暗黙の了解である。
