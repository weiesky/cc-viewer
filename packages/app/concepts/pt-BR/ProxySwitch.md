# Proxy de Troca Rápida

## Visão Geral

O Proxy de Troca Rápida permite redirecionar dinamicamente as requisições de API para um endpoint diferente sem reiniciar o Claude Code. Isso é útil ao usar serviços de proxy de API de terceiros.

> ⚠️ Não use este recurso se você for assinante do Claude Max.

## Campos

| Campo | Obrigatório | Descrição |
|-------|-------------|-----------|
| **Name** | ✅ | Nome de exibição deste proxy, usado para identificá-lo |
| **Base URL** | ✅ | URL base do serviço de API (ex. `https://api.example.com`). A origem original da requisição será substituída |
| **API Key** | ✅ | Chave de API do serviço de proxy, substitui a autenticação original |
| **ANTHROPIC_MODEL** | ❌ | Modelo primário. Requisições cujo modelo pertence à família `fable` / `mythos` são reescritas para este |
| **ANTHROPIC_DEFAULT_OPUS_MODEL** | ❌ | Estendido: requisições cujo modelo contém `opus` são reescritas para este |
| **ANTHROPIC_DEFAULT_SONNET_MODEL** | ❌ | Estendido: requisições cujo modelo contém `sonnet` são reescritas para este |
| **ANTHROPIC_DEFAULT_HAIKU_MODEL** | ❌ | Estendido: requisições cujo modelo contém `haiku` são reescritas para este |
| **Effort Level** | ❌ | Injeta `output_config.effort` (`low`/`medium`/`high`/`xhigh`/`max`) no corpo da requisição. Deixe como "Default" para ignorar |

A correspondência de modelo é um teste de substring sem distinção entre maiúsculas e minúsculas no campo `model` da requisição, de modo que qualquer versão (ex. `claude-opus-4-8`, um futuro `claude-opus-5`) mapeia para a mesma família sem reconfiguração. Um campo de família vazio significa que essa família permanece inalterada; uma família não reconhecida passa sem modificação.

## Como Funciona

Quando um proxy está ativo, o `server/interceptor.js` executa o seguinte antes de cada requisição de API:

1. **URL Rewrite** — Substitui a origem da requisição pela Base URL do proxy
2. **Auth Replace** — Substitui o cabeçalho `x-api-key` ou `Authorization` pela API Key do proxy
3. **Model Replace** — Reescreve o campo `model` do corpo da requisição por família (opus/sonnet/haiku → o campo correspondente; fable/mythos → `ANTHROPIC_MODEL`)
4. **Effort Inject** — Se um nível de effort estiver definido, injeta `output_config.effort` (ignorado para requisições `count_tokens` / heartbeat)

## Arquivo de Configuração

A configuração é armazenada em `~/.claude/cc-viewer/profile.json`. Clique no ícone de pasta no título para abrir o diretório:

```json
{
  "active": "my-proxy",
  "profiles": [
    { "id": "max", "name": "Max" },
    {
      "id": "my-proxy",
      "name": "My Proxy",
      "baseURL": "https://api.example.com",
      "apiKey": "sk-xxx",
      "ANTHROPIC_MODEL": "model-primary",
      "ANTHROPIC_DEFAULT_OPUS_MODEL": "model-opus",
      "ANTHROPIC_DEFAULT_SONNET_MODEL": "model-sonnet",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL": "model-haiku",
      "effort": "max"
    }
  ]
}
```

- `active` — ID do perfil atual. Defina como `"max"` para conexão direta (sem proxy)
- `profiles` — Lista de perfis. `id: "max"` é integrado e não pode ser excluído
- Perfis legados que usam `models` / `activeModel` são migrados automaticamente para `ANTHROPIC_MODEL` no carregamento
- As alterações entram em vigor em ~1,5 segundos (monitorado via `fs.watchFile`), sem necessidade de reiniciar
