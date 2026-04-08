# Descrição dos campos do Request Body

Descrição dos campos de nível superior do corpo da requisição da API Claude `/v1/messages`.

## Lista de campos

| Campo | Tipo | Descrição |
|-------|------|-----------|
| **model** | string | Nome do modelo utilizado, como `claude-opus-4-6`, `claude-sonnet-4-6` |
| **messages** | array | Histórico de mensagens da conversa. Cada mensagem contém `role` (user/assistant) e `content` (um array de blocos: texto, imagens, tool_use, tool_result etc.) |
| **system** | array | System prompt. Contém as instruções principais do Claude Code, instruções de uso de ferramentas, informações do ambiente, conteúdo do CLAUDE.md etc. Blocos com `cache_control` são armazenados em cache através do prompt caching |
| **tools** | array | Lista de definições de ferramentas disponíveis. Cada ferramenta contém `name`, `description` e `input_schema` (JSON Schema). O MainAgent tipicamente possui 20+ ferramentas, enquanto SubAgents possuem apenas algumas |
| **metadata** | object | Metadados da requisição, tipicamente contém `user_id` para identificação do usuário |
| **max_tokens** | number | Número máximo de tokens por resposta do modelo, como `16000`, `64000` |
| **thinking** | object | Configuração do pensamento estendido. `type: "enabled"` ativa o modo de pensamento, `budget_tokens` controla o limite de tokens para o pensamento |
| **context_management** | object | Configuração do gerenciamento de contexto. `truncation: "auto"` permite que o Claude Code trunque automaticamente históricos de mensagens muito longos |
| **output_config** | object | Configuração de saída, como configurações de `format` |
| **stream** | boolean | Se as respostas em streaming estão habilitadas. O Claude Code sempre utiliza `true` |

## Estrutura de messages

O `content` de cada mensagem é um array de blocos com os seguintes tipos comuns:

- **text**: Conteúdo de texto normal
- **tool_use**: O modelo invoca uma ferramenta (contém `name`, `input`)
- **tool_result**: Resultado da execução da ferramenta (contém `tool_use_id`, `content`)
- **image**: Conteúdo de imagem (base64 ou URL)
- **thinking**: Processo de pensamento do modelo (modo de pensamento estendido)

## Estrutura de system

O array do system prompt tipicamente contém:

1. **Instruções principais do agent** ("You are Claude Code...")
2. **Especificações de uso de ferramentas**
3. **Conteúdo do CLAUDE.md** (instruções em nível de projeto)
4. **Lembretes de skills** (skills reminder)
5. **Informações do ambiente** (OS, shell, status do git etc.) — Na verdade, o Claude Code depende fortemente do git. Se existir um repositório git no projeto, o Claude Code consegue demonstrar uma compreensão melhor do projeto, incluindo a capacidade de buscar alterações remotas e históricos de commits para auxiliar na análise

Blocos marcados com `cache_control: { type: "ephemeral" }` são armazenados em cache pela API da Anthropic por 5 minutos. Quando o cache é utilizado, a cobrança é feita por `cache_read_input_tokens` (muito inferior a `input_tokens`).

> **Nota**: Para clientes especiais como o Claude Code, o servidor da Anthropic na verdade não depende completamente do atributo `cache_control` na requisição para determinar o comportamento de cache. O servidor executa automaticamente estratégias de cache para campos específicos (como system prompt e definições de ferramentas), mesmo quando a requisição não contém explicitamente o marcador `cache_control`. Portanto, quando você não encontrar esse atributo no corpo da requisição, não há motivo para estranhamento — o servidor já realizou as operações de cache nos bastidores, sem expor essa informação ao cliente. Isso é uma espécie de entendimento tácito entre o Claude Code e a API da Anthropic.
