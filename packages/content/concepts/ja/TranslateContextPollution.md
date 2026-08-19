# 翻訳APIのコンテキスト汚染

## 背景

CC-Viewerには、Anthropic Messages APIを利用した組み込み翻訳機能（`POST /api/translate`）が含まれています。初期の実装では、翻訳リクエストがClaude Codeセッションからキャッシュされた認証情報（`x-api-key`と`authorization`ヘッダーの両方）を再利用していました。これにより、微妙ながら深刻な問題が発生しました：翻訳結果に無関係なコンテンツが頻繁に返されるようになったのです。

## 根本原因

### 2つの認証方式の本質的な違い

Anthropic APIは2つの認証方式をサポートしています：

| 方式 | ヘッダー | 典型的なソース | 特徴 |
|------|----------|----------------|------|
| APIキー | `x-api-key: sk-ant-...` | 環境変数 / Console | ステートレス、各リクエストが独立 |
| OAuthトークン | `authorization: Bearer sessionToken` | Claude Codeサブスクリプションログイン | セッションに紐づき、サーバーがコンテキストの関連付けを維持 |

重要な違い：**APIキーはステートレス**であり、各リクエストは完全に独立しています。一方、**OAuthセッショントークンはステートフル**であり、Anthropicサーバーは同じトークンを使用するリクエストを同一のセッションコンテキストに関連付けます。

### 汚染の連鎖

Claude Codeがサブスクリプション型OAuthログインを使用する場合、認証フローは以下のようになります：

```
Claude Code メイン会話 ──(authorization: Bearer sessionToken)──→ Anthropic API
                                                                    ↑
CC-Viewer 翻訳リクエスト ──(authorization: Bearer sessionToken)──→ Anthropic API
```

翻訳リクエストが同じセッショントークンを再利用していたため、Anthropicサーバーは翻訳リクエストをClaude Codeのメイン会話コンテキストに関連付ける可能性がありました。これにより以下の問題が発生します：

1. **翻訳結果がメイン会話のコンテキストに影響される**：翻訳リクエストのシステムプロンプトは「あなたは翻訳者です」ですが、サーバーコンテキストにはClaude Codeの会話履歴が残っており、モデルに干渉する可能性があります
2. **メイン会話が翻訳リクエストによって乱される**：翻訳リクエストの内容（UIテキストの断片）がメイン会話のコンテキストに注入され、Claude Codeの応答がずれる可能性があります
3. **予測不能な動作**：コンテキスト汚染はサーバー側の動作であるため、クライアント側では検出も制御もできません

## 教訓

- **OAuthセッショントークンは「単なる別のAPIキー」ではない** — サーバー側の状態を持っており、再利用はコンテキストの共有を意味します
- **内部サービス呼び出しには独立したステートレスな認証を使用すべき**であり、ユーザーセッションとの関連付けを避ける必要があります

## 参考資料

- [Anthropic API Authentication Docs](https://docs.anthropic.com/en/api/getting-started)
- [Claude Code Authentication](https://support.claude.com/en/articles/12304248-managing-api-key-environment-variables-in-claude-code)
- [Anthropic Bans Subscription OAuth in Third-Party Apps](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/)
- [Claude Code Authentication: API Keys, Subscriptions, and SSO](https://developertoolkit.ai/en/claude-code/quick-start/authentication/)
