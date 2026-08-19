# 翻譯 API 上下文污染

## 背景

CC-Viewer 內建了一個由 Anthropic Messages API 驅動的翻譯功能（`POST /api/translate`）。在早期實作中，翻譯請求會重複使用 Claude Code 工作階段中快取的驗證憑證——包括 `x-api-key` 和 `authorization` 標頭。這導致了一個微妙但嚴重的問題：翻譯結果經常回傳無關的內容。

## 根本原因

### 兩種驗證方式的本質差異

Anthropic API 支援兩種驗證方式：

| 方式 | 標頭 | 典型來源 | 特性 |
|------|------|----------|------|
| API 金鑰 | `x-api-key: sk-ant-...` | 環境變數 / Console | 無狀態，每個請求獨立 |
| OAuth 權杖 | `authorization: Bearer sessionToken` | Claude Code 訂閱登入 | 綁定工作階段，伺服器維護上下文關聯 |

關鍵差異：**API 金鑰是無狀態的**——每個請求完全獨立；而 **OAuth 工作階段權杖是有狀態的**——Anthropic 伺服器會將使用相同權杖的請求關聯到同一個工作階段上下文。

### 污染鏈

當 Claude Code 使用訂閱制 OAuth 登入時，驗證流程如下：

```
Claude Code 主要對話 ──(authorization: Bearer sessionToken)──→ Anthropic API
                                                                  ↑
CC-Viewer 翻譯請求 ──(authorization: Bearer sessionToken)──→ Anthropic API
```

由於翻譯請求重複使用了相同的工作階段權杖，Anthropic 伺服器可能會將翻譯請求與 Claude Code 的主要對話上下文產生關聯。這會導致：

1. **翻譯結果受到主要對話上下文的影響**：翻譯請求的系統提示詞是「你是一位翻譯員」，但伺服器上下文仍包含 Claude Code 的對話歷史，可能干擾模型的輸出
2. **主要對話被翻譯請求干擾**：翻譯請求的內容（UI 文字片段）可能被注入主要對話的上下文中，導致 Claude Code 的回應偏離
3. **不可預測的行為**：由於上下文污染是伺服器端的行為，客戶端無法偵測或控制

## 經驗教訓

- **OAuth 工作階段權杖不是「只是另一把 API 金鑰」**——它們攜帶伺服器端狀態，重複使用意味著共享上下文
- **內部服務呼叫應使用獨立的無狀態驗證**，以避免與使用者工作階段產生關聯

## 參考資料

- [Anthropic API Authentication Docs](https://docs.anthropic.com/en/api/getting-started)
- [Claude Code Authentication](https://support.claude.com/en/articles/12304248-managing-api-key-environment-variables-in-claude-code)
- [Anthropic Bans Subscription OAuth in Third-Party Apps](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/)
- [Claude Code Authentication: API Keys, Subscriptions, and SSO](https://developertoolkit.ai/en/claude-code/quick-start/authentication/)
