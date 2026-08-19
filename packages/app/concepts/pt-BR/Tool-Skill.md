# Skill

Invoca uma skill nomeada dentro da conversa atual. Skills são pacotes pré-configurados de capacidades — conhecimento de domínio, workflows e, às vezes, acesso a ferramentas — que o harness expõe ao assistente via avisos de sistema.

## Quando usar

- O usuário digita um slash command como `/review` ou `/init` — slash commands são skills e devem ser executadas por esta ferramenta.
- O usuário descreve uma tarefa que corresponde às condições de gatilho de uma skill anunciada (por exemplo, pedir para escanear transcripts em busca de prompts de permissão repetidos corresponde a `fewer-permission-prompts`).
- O propósito declarado de uma skill é uma correspondência direta para o arquivo, pedido ou contexto da conversa atual.
- Workflows especializados e repetíveis estão disponíveis como skills e o procedimento canônico é preferível a uma abordagem ad hoc.
- O usuário pergunta "quais skills estão disponíveis" — liste os nomes anunciados e invoque apenas quando confirmarem.

## Parâmetros

- `skill` (string, obrigatório): O nome exato de uma skill listada no aviso atual de skills disponíveis. Para skills com namespace de plugin, use o formato totalmente qualificado `plugin:skill` (por exemplo `skill-creator:skill-creator`). Não inclua barra inicial.
- `args` (string, opcional): Argumentos em texto livre passados para a skill. O formato e a semântica são definidos pela documentação de cada skill.

## Exemplos

### Exemplo 1: Executar uma skill de revisão na branch atual

```
Skill(skill="review")
```

A skill `review` empacota os passos para revisar um pull request contra a branch base atual. Invocá-la carrega o procedimento de revisão definido no harness no turno.

### Exemplo 2: Invocar uma skill com namespace de plugin com argumentos

```
Skill(
  skill="skill-creator:skill-creator",
  args="create a skill that summarizes git log for a given date range"
)
```

Roteia o pedido pelo ponto de entrada do plugin `skill-creator` para que o workflow de autoria seja acionado.

## Observações

- Invoque apenas skills cujos nomes aparecem literalmente no aviso de sistema de skills disponíveis, ou skills que o usuário digitou diretamente como `/name` em sua mensagem. Nunca adivinhe ou invente nomes de skill a partir de memória ou dados de treinamento — se a skill não está anunciada, não chame esta ferramenta.
- Quando o pedido de um usuário corresponde a uma skill anunciada, chamar `Skill` é pré-requisito bloqueante: invoque-a antes de gerar qualquer outra resposta sobre a tarefa. Não descreva o que a skill faria — execute-a.
- Nunca mencione uma skill pelo nome sem realmente invocá-la. Anunciar uma skill sem chamar a ferramenta é enganoso.
- Não use `Skill` para comandos de CLI embutidos como `/help`, `/clear`, `/model` ou `/exit`. Esses são tratados diretamente pelo harness.
- Não reinvoque uma skill que já está rodando no turno atual. Se você ver uma tag `<command-name>` no turno atual, a skill já foi carregada — siga suas instruções no local em vez de chamar a ferramenta de novo.
- Se várias skills puderem se aplicar, escolha a mais específica. Para mudanças de configuração como adicionar permissões ou hooks, prefira `update-config` em vez de uma abordagem genérica de settings.
- A execução de uma skill pode introduzir novos avisos de sistema, ferramentas ou restrições para o restante do turno. Releia o estado da conversa depois que uma skill terminar antes de prosseguir.
