# EnterPlanMode

Coloca a sessão em modo de plano, uma fase de exploração somente leitura em que o assistente investiga o codebase e elabora um plano de implementação concreto para o usuário aprovar antes que qualquer arquivo seja modificado.

## Quando usar

- O usuário pede uma mudança não trivial que abrange múltiplos arquivos ou subsistemas.
- Os requisitos são ambíguos e o assistente precisa ler código antes de se comprometer com uma abordagem.
- Uma refatoração, migração ou atualização de dependência é proposta e o raio de impacto não está claro.
- O usuário diz explicitamente "planeje isso", "vamos planejar primeiro" ou solicita uma revisão de design.
- O risco é alto o suficiente para que ir direto para edições possa desperdiçar trabalho ou danificar o estado.

## Parâmetros

Nenhum. `EnterPlanMode` não recebe argumentos — invoque-o com um objeto de parâmetros vazio.

## Exemplos

### Exemplo 1: Pedido grande de funcionalidade

O usuário pede: "Adicione SSO via Okta ao painel de admin." O assistente chama `EnterPlanMode`, depois passa várias rodadas lendo middleware de autenticação, armazenamento de sessão, guards de rota e UI de login existente. Ele escreve um plano descrevendo as mudanças necessárias, passos de migração e cobertura de testes, depois submete via `ExitPlanMode` para aprovação.

### Exemplo 2: Refatoração arriscada

O usuário diz: "Converta os controllers REST para tRPC." O assistente entra em modo de plano, examina cada controller, cataloga o contrato público, lista fases de rollout (shim, dual-read, cutover) e propõe um plano de sequenciamento antes de tocar em qualquer arquivo.

## Observações

- O modo de plano é somente leitura por contrato. Enquanto está nele, o assistente não deve executar `Edit`, `Write`, `NotebookEdit` ou qualquer comando de shell que mute estado. Use apenas `Read`, `Grep`, `Glob` e comandos `Bash` não destrutivos.
- Não entre em modo de plano para edições triviais de uma linha, perguntas puramente de pesquisa ou tarefas em que o usuário já especificou a mudança em detalhes completos. O overhead prejudica mais do que ajuda.
- No modo Auto, o modo de plano é desencorajado a menos que o usuário peça explicitamente — o modo Auto prefere ação em vez de planejamento antecipado.
- Use o modo de plano para reduzir correções de rumo em trabalho caro. Um plano de cinco minutos muitas vezes economiza uma hora de edições mal direcionadas.
- Uma vez no modo de plano, foque a investigação nas partes do sistema que realmente mudarão. Evite passeios exaustivos pelo repositório não relacionados à tarefa em questão.
- O plano em si deve ser gravado no disco no caminho que o harness espera para que `ExitPlanMode` possa submetê-lo. O plano deve conter caminhos de arquivos concretos, nomes de funções e passos de verificação, não intenções vagas.
- O usuário pode rejeitar o plano e pedir revisões. Itere dentro do modo de plano até que o plano seja aceito; só então saia.
