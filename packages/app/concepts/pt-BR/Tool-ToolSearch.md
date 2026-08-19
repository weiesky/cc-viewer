# ToolSearch

Busca sob demanda as definições completas de schema das "ferramentas adiadas" para que elas se tornem chamáveis. Quando há muitas ferramentas disponíveis, algumas não são carregadas de antemão — elas aparecem apenas pelo nome dentro de mensagens `<system-reminder>`. Até que seu schema seja buscado, apenas o nome é conhecido e não há definição de parâmetros, portanto a ferramenta não pode ser invocada. O `ToolSearch` recebe uma consulta, faz a correspondência com a lista de ferramentas adiadas e retorna as definições JSONSchema completas das ferramentas correspondentes dentro de um bloco `<functions>`. Assim que o schema de uma ferramenta aparece no resultado, ela pode ser chamada exatamente como qualquer ferramenta definida no topo do prompt.

## Quando usar

- Você precisa de uma ferramenta adiada — o nome dela aparece em um `<system-reminder>`, mas não há definição de parâmetros para ela na lista de ferramentas de nível superior.
- Você quer usar as ferramentas de um servidor MCP (por exemplo, Slack, Gmail, computer-use) que são carregadas sob demanda.
- Você não tem certeza do nome exato da ferramenta para uma capacidade e quer trazer à tona os candidatos por palavra-chave de uma só vez.

Se o schema de uma ferramenta já está no contexto, não busque novamente — apenas chame-a.

## Ativação

- Ativado por padrão.
- Desativado quando `ANTHROPIC_BASE_URL` aponta para um endpoint que não é da Anthropic (a menos que `ENABLE_TOOL_SEARCH` esteja definido), quando `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` está definido, quando o modelo não tem suporte a tool-reference (modelos Vertex AI anteriores ao Claude 4.5) ou quando negado via `"deny": ["ToolSearch"]`.

## Parâmetros

- `query` (string, obrigatório): A consulta usada para localizar ferramentas adiadas. Três formas são suportadas:
  - `select:Read,Edit,Grep` — busca essas ferramentas exatas pelo nome.
  - `notebook jupyter` — busca por palavra-chave, retornando até `max_results` melhores correspondências.
  - `+slack send` — exige que `slack` apareça no nome da ferramenta e, em seguida, classifica pelos termos restantes.
- `max_results` (number, opcional): Número máximo de resultados a retornar. O padrão é 5.

## Exemplos

### Exemplo 1: Buscar pelo nome exato

```
ToolSearch(query="select:WebFetch,WebSearch", max_results=5)
```

### Exemplo 2: Busca por palavra-chave

```
ToolSearch(query="notebook jupyter", max_results=5)
```

### Exemplo 3: Carregar um kit MCP inteiro de uma só vez

Ao carregar em massa todas as ferramentas de um servidor MCP (por exemplo, computer-use), use uma única busca por palavra-chave em vez de selecionar cada uma — o nome do servidor como substring corresponde a todas as ferramentas sob esse servidor:

```
ToolSearch(query="computer-use", max_results=30)
```

## Observações

- Antes de invocar uma ferramenta adiada, você deve primeiro buscar seu schema com `ToolSearch` — chamá-la diretamente falha porque a definição de parâmetros está ausente.
- Ao carregar em massa um kit inteiro (por exemplo, todas as ferramentas de um servidor MCP), prefira uma única busca por palavra-chave a muitas chamadas `select:` para reduzir as idas e voltas.
- Assim que um schema é buscado, a ferramenta se comporta exatamente como qualquer ferramenta normal; não busque novamente a mesma ferramenta.
- Os resultados retornam como um bloco `<functions>`, cada ferramenta uma única linha `<function>{...}</function>` — a mesma codificação da lista de ferramentas de nível superior.
