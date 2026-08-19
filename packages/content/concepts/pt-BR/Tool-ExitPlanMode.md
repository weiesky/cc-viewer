# ExitPlanMode

Submete o plano de implementação que foi elaborado durante o modo de plano para aprovação do usuário e — se aprovado — transiciona a sessão para fora do modo de plano para que as edições possam começar.

## Quando usar

- Um plano escrito durante `EnterPlanMode` está completo e pronto para revisão.
- A tarefa é focada em implementação (mudanças de código ou configuração), não pura pesquisa, então um plano explícito é apropriado.
- Toda a leitura e análise pré-requisitos foi feita; nenhuma investigação adicional é necessária antes de o usuário decidir.
- O assistente enumerou caminhos de arquivos, funções e passos concretos — não apenas objetivos.
- O usuário pediu para ver o plano, ou o workflow de modo de plano está prestes a passar para ferramentas de edição.

## Parâmetros

- `allowedPrompts` (array, opcional): Prompts que o usuário pode digitar na tela de aprovação para aprovar automaticamente ou alterar o plano. Cada elemento especifica uma permissão com escopo (por exemplo, um nome de operação e a ferramenta à qual se aplica). Deixe sem definir para usar o fluxo padrão de aprovação.

## Exemplos

### Exemplo 1: Submissão padrão

Depois de investigar uma refatoração de autenticação dentro do modo de plano e gravar o arquivo de plano no disco, o assistente chama `ExitPlanMode` sem argumentos. O harness lê o plano de sua localização canônica, exibe-o ao usuário e aguarda aprovação ou rejeição.

### Exemplo 2: Ações rápidas pré-aprovadas

```
ExitPlanMode(allowedPrompts=[
  {"tool": "Bash", "prompt": "run tests"},
  {"tool": "Bash", "prompt": "install dependencies"}
])
```

Permite que o usuário conceda permissão antecipadamente para comandos de acompanhamento rotineiros, para que o assistente não precise pausar para cada prompt de permissão durante a implementação.

## Observações

- `ExitPlanMode` só faz sentido para trabalho em estilo de implementação. Se o pedido do usuário é uma tarefa de pesquisa ou explicação sem mudanças de arquivo, responda diretamente em vez disso — não roteie através do modo de plano apenas para sair dele.
- O plano já deve estar gravado no disco antes de chamar esta ferramenta. `ExitPlanMode` não aceita o corpo do plano como parâmetro; ele lê do caminho que o harness espera.
- Se o usuário rejeitar o plano, você retorna ao modo de plano. Revise com base no feedback e submeta novamente; não comece a editar arquivos enquanto o plano não for aprovado.
- A aprovação concede permissão para sair do modo de plano e usar ferramentas que mutam estado (`Edit`, `Write`, `Bash` e assim por diante) para o escopo descrito no plano. Expandir o escopo depois exige um novo plano ou consentimento explícito do usuário.
- Não use `AskUserQuestion` para perguntar "este plano parece bom?" antes de chamar esta ferramenta — solicitar aprovação do plano é exatamente o que `ExitPlanMode` faz, e o usuário não pode ver o plano até que ele seja submetido.
- Mantenha o plano mínimo e acionável. Um revisor deve ser capaz de passar os olhos em menos de um minuto e entender exatamente o que mudará.
- Se você perceber no meio da implementação que o plano estava errado, pare e reporte ao usuário em vez de desviar silenciosamente. Reentrar no modo de plano é um próximo passo válido.
