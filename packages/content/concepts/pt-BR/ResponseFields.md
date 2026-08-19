# Descrição dos campos do Response Body

Descrição dos campos do corpo de resposta da API Claude `/v1/messages`.

## Campos de nível superior

| Campo | Tipo | Descrição |
|-------|------|-----------|
| **model** | string | Nome do modelo efetivamente utilizado, ex.: `claude-opus-4-6` |
| **id** | string | Identificador único desta resposta, ex.: `msg_01Tgsr2QeH8AVXGoP2wAXRvU` |
| **type** | string | Sempre `"message"` |
| **role** | string | Sempre `"assistant"` |
| **content** | array | Array de blocos de conteúdo produzidos pelo modelo, incluindo texto, chamadas de ferramentas, processo de raciocínio, etc. |
| **stop_reason** | string | Motivo da parada: `"end_turn"` (conclusão normal), `"tool_use"` (necessária execução de ferramenta), `"max_tokens"` (limite de tokens atingido) |
| **stop_sequence** | string/null | A sequência que acionou a parada, geralmente `null` |
| **usage** | object | Estatísticas de uso de tokens (veja abaixo) |

## Tipos de bloco content

| Tipo | Descrição |
|------|-----------|
| **text** | Resposta em texto do modelo, contém o campo `text` |
| **tool_use** | Requisição de chamada de ferramenta, contém `name` (nome da ferramenta), `input` (parâmetros), `id` (ID da chamada, usado para associar ao tool_result) |
| **thinking** | Conteúdo do raciocínio estendido (aparece apenas com o modo thinking ativado), contém o campo `thinking` |

## Detalhamento dos campos usage

| Campo | Descrição |
|-------|-----------|
| **input_tokens** | Número de tokens de entrada não encontrados no cache (cobrados pelo preço integral) |
| **cache_creation_input_tokens** | Número de tokens para os quais um novo cache foi criado nesta requisição (escrita em cache, custo superior à entrada normal) |
| **cache_read_input_tokens** | Número de tokens lidos do cache (leitura de cache, custo muito inferior à entrada normal) |
| **output_tokens** | Número de tokens produzidos pelo modelo |
| **service_tier** | Nível de serviço, ex.: `"standard"` |
| **inference_geo** | Região de inferência, ex.: `"not_available"` indica que a informação de região não está disponível |

## Subcampos de cache_creation

| Campo | Descrição |
|-------|-----------|
| **ephemeral_5m_input_tokens** | Número de tokens para criação de cache de curto prazo com TTL de 5 minutos |
| **ephemeral_1h_input_tokens** | Número de tokens para criação de cache de longo prazo com TTL de 1 hora |

> **Sobre a tarifação do cache**: O preço unitário de `cache_read_input_tokens` é muito inferior ao de `input_tokens`, enquanto o preço unitário de `cache_creation_input_tokens` é ligeiramente superior ao da entrada normal. Portanto, manter uma alta taxa de acerto de cache em conversas contínuas pode reduzir significativamente os custos. Através da métrica "taxa de acerto" do cc-viewer é possível monitorar visualmente essa proporção.

## Significado de stop_reason

- **end_turn**: O modelo concluiu a resposta normalmente
- **tool_use**: O modelo precisa chamar uma ferramenta; content conterá um bloco `tool_use`. Na próxima requisição é necessário adicionar um `tool_result` em messages para continuar a conversa
- **max_tokens**: O limite `max_tokens` foi atingido, a resposta foi truncada e pode estar incompleta
