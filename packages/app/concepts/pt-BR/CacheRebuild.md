# Cache Rebuild (Reconstrução de Cache)

## Contexto

O mecanismo de prompt caching da Anthropic concatena sequencialmente system → tools → messages (até o cache breakpoint) da requisição para formar a chave de cache. Quando a chave de cache é idêntica à da requisição anterior, a API retorna `cache_read_input_tokens` (acerto de cache); quando a chave de cache muda, a API recria o cache e retorna uma grande quantidade de `cache_creation_input_tokens`, ou seja, reconstrução de cache.

A reconstrução de cache implica cobrança adicional de tokens (o preço de cache creation é maior que o de cache read), portanto identificar a causa da reconstrução tem valor direto para otimização de custos.

## Classificação das Causas de Reconstrução de Cache

O cc-viewer determina com precisão a causa da reconstrução de cache comparando os bodies de duas requisições MainAgent consecutivas:

| reason | Significado | Método de Determinação |
|--------|------|----------|
| `ttl` | Cache expirado | Mais de 5 minutos desde a última requisição MainAgent |
| `system_change` | Alteração do system prompt | `JSON.stringify(prev.system) !== JSON.stringify(curr.system)` |
| `tools_change` | Alteração das definições de ferramentas | `JSON.stringify(prev.tools) !== JSON.stringify(curr.tools)` |
| `model_change` | Troca de modelo | `prev.model !== curr.model` |
| `msg_truncated` | Pilha de mensagens truncada | O número de mensagens da requisição atual é menor que o da anterior, geralmente causado por truncamento devido ao estouro da janela de contexto |
| `msg_modified` | Mensagens históricas modificadas | Conteúdo das mensagens de prefixo inconsistente (em adição normal, o prefixo deve ser idêntico) |
| `key_change` | Alteração de chave desconhecida | Fallback quando nenhuma das condições acima é correspondida |

## Prioridade de Determinação

1. Primeiro verifica o intervalo de tempo — se ultrapassar 5 minutos, determina diretamente como `ttl`, sem comparação de body
2. Em seguida verifica sequencialmente model, system, tools, messages
3. Uma requisição pode corresponder a múltiplas causas simultaneamente (ex: troca de modelo + alteração de system prompt), nesse caso o array `reasons` contém todos os itens correspondentes, e o tooltip exibe em linhas separadas

## Cenários Comuns

- **`ttl`**: O usuário pausou a operação por mais de 5 minutos e depois continuou, o cache expirou naturalmente
- **`system_change`**: O Claude Code atualizou o system prompt (ex: carregou novo CLAUDE.md, alteração nas project instructions)
- **`tools_change`**: Conexão/desconexão de MCP server causou alteração na lista de ferramentas disponíveis
- **`model_change`**: O usuário trocou o modelo através do comando `/model`
- **`msg_truncated`**: Conversa muito longa acionou o gerenciamento da janela de contexto, o Claude Code truncou mensagens anteriores
- **`msg_modified`**: O Claude Code editou mensagens históricas (ex: `/compact` substituiu mensagens originais por resumo compactado)
