# Por que os Tools são listados primeiro?

No painel Context do cc-viewer, **os Tools aparecem antes do System Prompt e dos Messages**. Essa ordenação reflete precisamente a **sequência de prefixo KV-Cache da API da Anthropic**.

## Sequência de prefixo KV-Cache

Quando a API da Anthropic constrói o KV-Cache, ela concatena o contexto em um prefixo nesta **ordem fixa**:

```
┌─────────────────────────────────────────────────┐
│ 1. Tools (JSON Schema definitions)               │  ← Start of cache prefix
│ 2. System Prompt                                 │
│ 3. Messages (conversation history + current turn)│  ← End of cache prefix
└─────────────────────────────────────────────────┘
```

Isso significa que **os Tools ficam antes do System Prompt, bem no início do prefixo de cache**.

## Por que os Tools têm maior peso de cache do que System?

Na correspondência de prefixo KV-Cache, **o conteúdo anterior é mais crítico** — qualquer alteração invalida tudo o que vem depois:

1. **A correspondência de prefixo começa pelo início**: O KV-Cache compara a requisição atual com o prefixo em cache token por token desde o início. No momento em que uma divergência é encontrada, todo o conteúdo subsequente é invalidado.

2. **Alteração nos Tools = cache inteiro invalidado**: Como os Tools vêm primeiro, qualquer alteração nas definições de tool (mesmo adicionar ou remover um único MCP tool) **quebra o prefixo desde o início absoluto**, invalidando todos os System Prompt e Messages em cache.

3. **Alteração no System = cache de Messages invalidado**: O System Prompt fica no meio, então suas alterações invalidam apenas a porção de Messages que o segue.

4. **Alteração nos Messages = apenas o final é afetado**: Os Messages ficam no final, então adicionar novos messages invalida apenas um pequeno segmento final — os caches de Tools e System permanecem intactos.

## Impacto prático

| Tipo de alteração | Impacto no cache | Cenário típico |
|-------------|-------------|-----------------|
| Tool adicionado/removido | **Invalidação completa** | Conexão/desconexão de servidor MCP, ativação/desativação de plugin de IDE |
| Alteração no System Prompt | Cache de Messages perdido | Edição de CLAUDE.md, injeção de system reminder |
| Novo message adicionado | Apenas incremento de cauda | Fluxo de conversa normal (o mais comum, o mais barato) |

É por isso que `tools_change` no [CacheRebuild](CacheRebuild.md) tende a ser o motivo de reconstrução mais custoso — ele quebra a cadeia de prefixo bem na frente.

## Por que as definições de ferramentas vêm antes do "cérebro"?

Do ponto de vista do cache, o fato de Tools estar em primeiro é um fato técnico. Mas do ponto de vista do design cognitivo, essa ordem é igualmente lógica — **Tools são as mãos e os pés, System Prompt é o cérebro**.

Antes de agir, uma pessoa precisa perceber quais membros e ferramentas tem disponíveis. Um bebê não entende primeiro as regras do mundo (System) para depois aprender a agarrar — ele primeiro percebe que tem mãos e pés, e gradualmente entende as regras pela interação com o ambiente. Da mesma forma, um LLM precisa saber quais ferramentas pode chamar (ler arquivos, escrever código, pesquisar, executar comandos) antes de receber as instruções da tarefa (System Prompt), para poder avaliar com precisão "o que posso fazer" e "como devo fazer" ao processar as instruções.

Se fosse invertido — primeiro dizer ao modelo "sua tarefa é refatorar este módulo", depois "você tem as ferramentas Read, Edit, Bash" — o modelo não teria informações cruciais sobre os limites de suas capacidades ao entender a tarefa, potencialmente produzindo planos irrealistas ou negligenciando abordagens disponíveis.

**Conhecer as cartas que se tem antes de decidir como jogar.** Esta é a lógica cognitiva por trás de Tools preceder System.

## Por que as ferramentas MCP também estão nesta posição?

Ferramentas MCP (Model Context Protocol), assim como ferramentas integradas, são posicionadas no início da área Tools. Entender a posição do MCP no contexto ajuda a avaliar seus reais benefícios e custos.

### Vantagens do MCP

- **Extensão de capacidades**: MCP permite que modelos acessem serviços externos (consultas a bancos de dados, chamadas API, operações IDE, controle de navegador, etc.), ultrapassando os limites das ferramentas integradas
- **Ecossistema aberto**: Qualquer pessoa pode implementar um servidor MCP; o modelo ganha novas capacidades sem retreinamento
- **Carregamento sob demanda**: Servidores MCP podem ser conectados/desconectados seletivamente conforme o cenário, compondo conjuntos de ferramentas flexíveis

### Custos do MCP

- **Assassino de cache**: A definição JSON Schema de cada ferramenta MCP é concatenada no início do prefixo KV-Cache. Adicionar ou remover uma ferramenta MCP = **todo o cache invalidado desde o início**. Conectar/desconectar servidores MCP com frequência reduz drasticamente a taxa de acerto do cache
- **Inchaço do prefixo**: Schemas de ferramentas MCP são tipicamente maiores que ferramentas integradas (descrições detalhadas de parâmetros, valores enum, etc.). Muitas ferramentas MCP aumentam significativamente a contagem de tokens na área Tools, reduzindo o espaço de contexto disponível para Messages
- **Overhead de latência**: Chamadas de ferramentas MCP requerem comunicação entre processos (JSON-RPC via stdio/SSE), uma ordem de magnitude mais lenta que chamadas de funções integradas
- **Risco de estabilidade**: Servidores MCP são processos externos que podem falhar, expirar ou retornar formatos inesperados, necessitando tratamento de erros adicional

### Recomendações práticas

| Cenário | Recomendação |
|---------|-------------|
| Conversas longas, interação frequente | Minimizar a quantidade de ferramentas MCP para proteger a estabilidade do prefixo de cache |
| Tarefas curtas, operações pontuais | Usar ferramentas MCP livremente; impacto no cache é limitado |
| Adição/remoção frequente de servidores MCP | Cada mudança dispara reconstrução completa do cache; considerar fixar o conjunto de ferramentas |
| Schemas de ferramentas superdimensionados | Reduzir descriptions e enums para diminuir o consumo de tokens no prefixo |

No painel Context do cc-viewer, ferramentas MCP são exibidas ao lado das ferramentas integradas na área Tools, oferecendo uma visão clara do tamanho do Schema de cada ferramenta e sua contribuição para o prefixo de cache.
