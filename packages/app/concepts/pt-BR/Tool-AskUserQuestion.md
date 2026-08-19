# AskUserQuestion

Apresenta ao usuário uma ou mais perguntas de múltipla escolha estruturadas dentro da interface do chat, coleta suas seleções e as devolve ao assistente — útil para desambiguar a intenção sem uma troca de mensagens em texto livre.

## Quando usar

- Um pedido tem múltiplas interpretações razoáveis e o assistente precisa que o usuário escolha uma antes de prosseguir.
- O usuário precisa escolher entre opções concretas (framework, biblioteca, caminho de arquivo, estratégia) onde respostas em texto livre seriam propensas a erro.
- Você quer comparar alternativas lado a lado usando o painel de pré-visualização.
- Várias decisões relacionadas podem ser agrupadas em um único prompt para reduzir idas e vindas.
- Um plano ou chamada de ferramenta depende de configuração que o usuário ainda não especificou.

## Parâmetros

- `questions` (array, obrigatório): De uma a quatro perguntas exibidas juntas em um único prompt. Cada objeto de pergunta contém:
  - `question` (string, obrigatório): O texto completo da pergunta, terminando com ponto de interrogação.
  - `header` (string, obrigatório): Um rótulo curto (no máximo 12 caracteres) renderizado como um chip acima da pergunta.
  - `options` (array, obrigatório): De duas a quatro opções. Cada opção tem um `label` (1–5 palavras), uma `description` e um `markdown` opcional para pré-visualização.
  - `multiSelect` (boolean, obrigatório): Quando `true`, o usuário pode escolher mais de uma opção.

## Exemplos

### Exemplo 1: Escolher um único framework

```
AskUserQuestion(questions=[{
  "header": "Test runner",
  "question": "Which test runner should I configure?",
  "multiSelect": false,
  "options": [
    {"label": "Vitest (Recommended)", "description": "Fast, Vite-native, Jest-compatible API"},
    {"label": "Jest",                  "description": "Mature, broadest plugin ecosystem"},
    {"label": "Node --test",           "description": "Zero dependencies, built in"}
  ]
}])
```

### Exemplo 2: Pré-visualização lado a lado de dois layouts

```
AskUserQuestion(questions=[{
  "header": "Layout",
  "question": "Which dashboard layout do you prefer?",
  "multiSelect": false,
  "options": [
    {"label": "Sidebar",  "description": "Nav on the left", "markdown": "```\n+------+---------+\n| NAV  | CONTENT |\n+------+---------+\n```"},
    {"label": "Top bar",  "description": "Nav across top",  "markdown": "```\n+-----------------+\n|       NAV       |\n+-----------------+\n|     CONTENT     |\n+-----------------+\n```"}
  ]
}])
```

## Observações

- A interface adiciona automaticamente uma opção "Other" de texto livre a cada pergunta. Não adicione sua própria entrada "Other", "None" ou "Custom" — ela duplicará a válvula de escape embutida.
- Limite cada chamada a entre uma e quatro perguntas e cada pergunta a entre duas e quatro opções. Exceder esses limites é rejeitado pelo harness.
- Se você recomendar uma opção específica, coloque-a em primeiro lugar e anexe "(Recommended)" ao seu label para que a interface destaque o caminho preferido.
- Pré-visualizações via o campo `markdown` só são suportadas em perguntas de seleção única. Use-as para artefatos visuais como layouts em ASCII, trechos de código ou diffs de configuração — não para perguntas simples de preferência onde label mais descrição bastam.
- Quando qualquer opção em uma pergunta tem um valor `markdown`, a interface muda para um layout lado a lado com a lista de opções à esquerda e a pré-visualização à direita.
- Não use `AskUserQuestion` para perguntar "este plano parece bom?" — chame `ExitPlanMode` em vez disso, que existe precisamente para aprovação de planos. No modo de plano, evite também mencionar "o plano" no texto da pergunta, pois o plano não é visível para o usuário até que `ExitPlanMode` seja executado.
- Não use esta ferramenta para solicitar entrada sensível ou de texto livre, como chaves de API ou senhas. Pergunte no chat em vez disso.
