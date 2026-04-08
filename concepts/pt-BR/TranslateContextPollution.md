# Poluição de Contexto na Translate API

## Contexto

O CC-Viewer inclui um recurso de tradução integrado (`POST /api/translate`) alimentado pela Anthropic Messages API. Na implementação inicial, as requisições de tradução reutilizavam credenciais de autenticação em cache da sessão do Claude Code — incluindo os cabeçalhos `x-api-key` e `authorization`. Isso causou um problema sutil, mas grave: os resultados da tradução frequentemente retornavam conteúdo irrelevante.

## Causa Raiz

### Diferença fundamental entre dois métodos de autenticação

A Anthropic API suporta dois métodos de autenticação:

| Método | Cabeçalho | Origem típica | Características |
|--------|-----------|---------------|-----------------|
| Chave de API | `x-api-key: sk-ant-...` | Variável de ambiente / Console | Sem estado, cada requisição é independente |
| Token OAuth | `authorization: Bearer sessionToken` | Login por assinatura do Claude Code | Vinculado à sessão, o servidor mantém associação de contexto |

A diferença fundamental: **Chaves de API são sem estado** — cada requisição é completamente independente; enquanto **tokens de sessão OAuth são com estado** — o servidor da Anthropic associa requisições que usam o mesmo token ao mesmo contexto de sessão.

### Cadeia de poluição

Quando o Claude Code usa login OAuth por assinatura, o fluxo de autenticação é assim:

```
Conversa principal do Claude Code ──(authorization: Bearer sessionToken)──→ Anthropic API
                                                                              ↑
Requisição de tradução do CC-Viewer ──(authorization: Bearer sessionToken)──→ Anthropic API
```

Como as requisições de tradução reutilizavam o mesmo token de sessão, o servidor da Anthropic pode associar as requisições de tradução ao contexto da conversa principal do Claude Code. Isso causa:

1. **Resultados de tradução influenciados pelo contexto da conversa principal**: O prompt de sistema da requisição de tradução é "você é um tradutor", mas o contexto do servidor ainda contém o histórico de conversas do Claude Code, potencialmente interferindo no modelo
2. **Conversa principal perturbada pelas requisições de tradução**: O conteúdo das requisições de tradução (fragmentos de texto da UI) pode ser injetado no contexto da conversa principal, fazendo com que as respostas do Claude Code desviem
3. **Comportamento imprevisível**: Como a poluição de contexto é um comportamento do lado do servidor, o cliente não pode detectá-la ou controlá-la

## Lições Aprendidas

- **Tokens de sessão OAuth não são "apenas mais uma chave de API"** — eles carregam estado do lado do servidor, e reutilizá-los significa compartilhar contexto
- **Chamadas internas de serviço devem usar autenticação independente e sem estado** para evitar associação com sessões de usuários

## Referências

- [Anthropic API Authentication Docs](https://docs.anthropic.com/en/api/getting-started)
- [Claude Code Authentication](https://support.claude.com/en/articles/12304248-managing-api-key-environment-variables-in-claude-code)
- [Anthropic Bans Subscription OAuth in Third-Party Apps](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/)
- [Claude Code Authentication: API Keys, Subscriptions, and SSO](https://developertoolkit.ai/en/claude-code/quick-start/authentication/)
