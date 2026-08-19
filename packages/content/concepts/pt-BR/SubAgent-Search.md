# SubAgent: Search

## Propósito

O subagente Search é um agente de exploração leve e somente leitura. Despache-o quando precisar entender um codebase — encontrar onde algo vive, aprender como componentes se encaixam ou responder perguntas estruturais — sem alterar nenhum arquivo. Ele é otimizado para muitas leituras pequenas em muitos arquivos, retornando um resumo conciso em vez de saída bruta de busca.

Search não é um assistente de propósito geral. Ele não pode editar código, rodar builds, commitar mudanças ou abrir conexões de rede além de fetches somente leitura. Seu valor é que pode queimar um grande orçamento de exploração em paralelo sem consumir o contexto do agente principal, e então devolver uma resposta compacta.

## Quando usar

- Você precisa responder a uma pergunta que requer três ou mais buscas ou leituras distintas. Exemplo: "Como a autenticação está conectada desde a rota de login até o armazenamento de sessão?"
- O alvo é desconhecido — você ainda não sabe qual arquivo, módulo ou símbolo olhar.
- Você precisa de uma visão estrutural de uma área desconhecida do repositório antes de fazer mudanças.
- Você quer cruzar múltiplos candidatos (por exemplo, qual dentre vários helpers com nomes similares é de fato chamado em produção).
- Você precisa de um resumo em estilo de revisão de literatura: "liste todo lugar que importa X e categorize por ponto de chamada."

Não use Search quando:

- Você já sabe o arquivo e a linha exatos. Chame `Read` diretamente.
- Um único `Grep` ou `Glob` responderá à pergunta. Rode diretamente; despachar um subagente adiciona overhead.
- A tarefa requer editar, rodar comandos ou qualquer efeito colateral. Search é somente leitura por design.
- Você precisa da saída exata literal de uma chamada de ferramenta. Subagentes resumem; não atuam como proxy de resultados brutos.

## Níveis de minúcia

Escolha o nível que corresponde ao peso da pergunta.

- `quick` — algumas buscas direcionadas, resposta de melhor esforço. Use quando precisar de uma pista rápida (por exemplo, "onde está a lógica de parsing de variáveis de ambiente?") e estiver confortável em iterar se a resposta for incompleta.
- `medium` — o padrão. Várias rodadas de busca, cross-check de candidatos e leitura dos arquivos mais relevantes por completo. Use para perguntas típicas do tipo "me ajude a entender esta área".
- `very thorough` — exploração exaustiva. O subagente perseguirá toda pista plausível, lerá contexto ao redor e reverificará achados antes de resumir. Use quando a correção importa (por exemplo, revisão de segurança, planejamento de migração) ou quando uma resposta incompleta causará retrabalho.

Minúcia mais alta custa mais tempo e tokens dentro do subagente, mas esses tokens ficam dentro do subagente — apenas o resumo final retorna ao agente principal.

## Ferramentas disponíveis

O Search tem acesso a todas as ferramentas somente leitura que o agente principal usa, e nada mais:

- `Read` — para ler arquivos específicos, incluindo intervalos parciais.
- `Grep` — para buscas de conteúdo na árvore.
- `Glob` — para localizar arquivos por padrão de nome.
- `Bash` em modo somente leitura — para comandos que inspecionam estado sem mutá-lo (por exemplo `git log`, `git show`, `ls`, `wc`).
- `WebFetch` e `WebSearch` — para ler documentação externa quando esse contexto for necessário.

Ferramentas de edição (`Write`, `Edit`, `NotebookEdit`), comandos de shell que modificam estado e ferramentas do grafo de tarefas (`TaskCreate`, `TaskUpdate` e assim por diante) estão deliberadamente indisponíveis.

## Observações

- Dê ao subagente Search uma pergunta específica, não um tópico. "Liste todo caller de `renderMessage` e anote quais passam um tema customizado" retorna uma resposta útil; "me conte sobre renderização" não.
- O subagente retorna um resumo. Se você precisa de caminhos de arquivo exatos, peça-os explicitamente em seu prompt.
- Múltiplas perguntas independentes são melhor despachadas como subagentes Search paralelos em vez de um prompt longo, para que cada um possa focar.
- Como Search não pode editar, emparelhe-o com um passo de edição subsequente no agente principal uma vez que você saiba o que mudar.
- Trate a saída do Search como evidência, não como verdade absoluta. Para qualquer coisa crítica, abra os arquivos citados você mesmo antes de agir.
