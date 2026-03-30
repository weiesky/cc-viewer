# Conteudo do KV-Cache

## O que e Prompt Caching?

Quando voce conversa com o Claude, cada requisicao da API envia o contexto completo da conversa (system prompt + definicoes de ferramentas + historico de mensagens). O mecanismo de prompt caching da Anthropic armazena no servidor o conteudo do prefixo ja calculado. Se requisicoes subsequentes tiverem o mesmo prefixo, os resultados armazenados sao reutilizados diretamente, pulando calculos redundantes e reduzindo significativamente a latencia e os custos.

No cc-viewer, esse mecanismo e chamado de "KV-Cache" e corresponde ao prompt caching no nivel da API da Anthropic, nao ao key-value cache interno das camadas de atencao do transformer do LLM.

## Como o caching funciona

O prompt caching da Anthropic constroi a chave de cache em uma ordem fixa:

```
Tools → System Prompt → Messages (ate o cache breakpoint)
```

Desde que esse prefixo corresponda exatamente a uma requisicao anterior dentro da janela de TTL, a API retornara um cache hit (`cache_read_input_tokens`) em vez de recalcular (`cache_creation_input_tokens`).

> **O Claude Code nao depende estritamente do atributo `cache_control`. O servidor remove parcialmente esses atributos, mas ainda consegue criar o cache de forma eficaz. Portanto, a ausencia do atributo `cache_control` nao significa que o conteudo nao foi armazenado em cache.**
>
> Para clientes especiais como o Claude Code, o servidor da Anthropic nao depende completamente do atributo `cache_control` na requisicao para determinar o comportamento do cache. O servidor executa automaticamente estrategias de cache para campos especificos (como system prompt e definicoes de ferramentas), mesmo quando a requisicao nao contem marcadores `cache_control` explicitos. Portanto, se voce nao vir esse atributo no corpo da requisicao, nao ha motivo para confusao — o servidor ja completou a operacao de cache nos bastidores, simplesmente nao expoe essa informacao ao cliente. Isso e um entendimento tacito entre o Claude Code e a API da Anthropic.

## O que e o "conteudo atual do KV-Cache"?

O "conteudo atual do KV-Cache" exibido no cc-viewer e extraido da ultima requisicao do MainAgent e inclui o conteudo anterior ao limite do cache (cache breakpoint). Especificamente, ele compreende:

- **System Prompt**: as instrucoes de sistema do Claude Code, incluindo instrucoes principais do agent, especificacoes de uso de ferramentas, instrucoes do projeto CLAUDE.md, informacoes do ambiente, etc.
- **Tools**: a lista de definicoes de ferramentas atualmente disponiveis (como Read, Write, Bash, Agent, ferramentas MCP, etc.)
- **Messages**: a parte armazenada do historico da conversa (tipicamente mensagens mais antigas, ate o ultimo marcador `cache_control`)

## Por que visualizar o conteudo do cache?

1. **Entender o contexto**: descubra quais conteudos o Claude tem atualmente "em memoria" para avaliar se seu comportamento corresponde as expectativas
2. **Otimizacao de custos**: cache hits custam muito menos do que recalculos. Visualizar o conteudo do cache ajuda a entender por que certas requisicoes acionaram uma reconstrucao do cache (cache rebuild)
3. **Debug de conversas**: quando as respostas do Claude nao correspondem as expectativas, verificar o conteudo do cache permite confirmar se o system prompt e o historico de mensagens estao corretos
4. **Monitoramento da qualidade do contexto**: durante o debug, alteracao de configuracoes ou ajuste de prompts, o KV-Cache-Text oferece uma visao centralizada que ajuda a verificar rapidamente se o contexto principal se degradou ou foi contaminado por conteudo inesperado — sem precisar percorrer manualmente cada mensagem original

## Estrategia de cache multinivel

O KV-Cache do Claude Code nao e composto por um unico cache. O servidor gera caches separados para Tools e System Prompt, independentes do cache de Messages. A vantagem desse design e que quando a pilha de mensagens apresenta problemas (como truncamento de contexto, alteracoes de mensagens, etc.) e precisa ser reconstruida, os caches de Tools e System Prompt nao sao invalidados junto, evitando um recalculo completo.

Esta e uma estrategia de otimizacao atual do servidor — como as definicoes de ferramentas e o system prompt sao relativamente estaveis durante o uso normal e raramente mudam, armazena-los separadamente em cache minimiza o overhead de reconstrucoes desnecessarias. Ao observar o cache, voce percebera que, alem da reconstrucao de Tools (que exige a atualizacao completa do cache), alteracoes no System Prompt e nas Messages ainda possuem caches herdaveis disponiveis.

## Ciclo de vida do cache

- **Criacao**: na primeira requisicao ou apos a invalidacao do cache, a API cria um novo cache (`cache_creation_input_tokens`)
- **Hit**: requisicoes subsequentes com prefixo identico reutilizam o cache (`cache_read_input_tokens`)
- **Expiracao**: o cache tem um TTL (Time to Live) de 5 minutos e expira automaticamente apos esse periodo
- **Reconstrucao**: quando o system prompt, a lista de ferramentas, o modelo ou o conteudo das mensagens mudam, a chave de cache nao corresponde mais e aciona uma reconstrucao do cache no nivel correspondente
