# 翻译接口 Context 污染问题

## 背景

CC-Viewer 内置了翻译功能（`POST /api/translate`），通过调用 Anthropic Messages API 实现文本翻译。在早期实现中，翻译请求会复用 Claude Code 会话中缓存的认证凭据——包括 `x-api-key` 和 `authorization` header。这导致了一个隐蔽但严重的问题：翻译结果频繁"答非所问"。

## 问题根因

### 两种认证方式的本质区别

Anthropic API 支持两种认证方式：

| 方式 | Header | 典型来源 | 特点 |
|------|--------|----------|------|
| API Key | `x-api-key: sk-ant-...` | 环境变量 / Console 生成 | 无状态，每次请求独立 |
| OAuth Token | `authorization: Bearer sessionToken` | Claude Code 订阅登录 | 绑定会话，服务端维护上下文关联 |

关键差异在于：**API Key 是无状态的**，每个请求完全独立；而 **OAuth session token 是有状态的**，Anthropic 服务端会将同一 token 的请求关联到同一会话上下文中。

### 污染链路

当 Claude Code 使用订阅 OAuth 登录时，认证流程如下：

```
Claude Code 主对话 ──(authorization: Bearer sessionToken)──→ Anthropic API
                                                              ↑
CC-Viewer 翻译请求 ──(authorization: Bearer sessionToken)──→ Anthropic API
```

由于翻译请求复用了同一个 session token，Anthropic 服务端可能将翻译请求与 Claude Code 的主对话关联到同一上下文。这会导致：

1. **翻译结果受主对话上下文影响**：翻译请求的 system prompt 是"你是一个翻译器"，但服务端上下文中还残留着 Claude Code 的对话历史，模型可能受到干扰
2. **主对话受翻译请求干扰**：翻译请求的内容（用户界面文本片段）可能被注入到主对话的上下文中，导致 Claude Code 的回复出现偏差
3. **不可预测的行为**：由于上下文污染是服务端行为，客户端无法感知也无法控制

## 经验总结

- **OAuth session token 不是"另一种 API Key"**——它携带服务端状态，复用它等于共享上下文
- **内部服务间调用应使用独立的、无状态的认证方式**，避免与用户会话产生关联

## 参考资料

- [Anthropic API 认证文档](https://docs.anthropic.com/en/api/getting-started) — `x-api-key` 与 `authorization` header 的官方说明
- [Claude Code 认证方式](https://support.claude.com/en/articles/12304248-managing-api-key-environment-variables-in-claude-code) — API Key 环境变量管理
- [Anthropic 禁止第三方应用使用订阅 OAuth](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/) — Anthropic 对 OAuth token 使用范围的限制
- [Claude Code Authentication: API Keys, Subscriptions, and SSO](https://developertoolkit.ai/en/claude-code/quick-start/authentication/) — 认证方式对比
