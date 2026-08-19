# Bash

Executa um comando de shell dentro de um diretório de trabalho persistente e retorna seu stdout/stderr. Melhor reservar para operações que nenhuma ferramenta dedicada do Claude Code consegue expressar, como executar git, npm, docker ou scripts de build.

## Quando usar

- Executar operações git (`git status`, `git diff`, `git commit`, `gh pr create`)
- Rodar gerenciadores de pacote e ferramentas de build (`npm install`, `npm run build`, `pytest`, `cargo build`)
- Iniciar processos de longa duração (dev servers, watchers) em segundo plano com `run_in_background`
- Invocar CLIs específicas de domínio (`docker`, `terraform`, `kubectl`, `gh`) que não têm equivalente embutido
- Encadear passos dependentes com `&&` quando a ordem importa

## Parâmetros

- `command` (string, obrigatório): O comando de shell exato a executar.
- `description` (string, obrigatório): Um resumo curto em voz ativa (5-10 palavras para comandos simples; mais contexto para os com pipes ou obscuros).
- `timeout` (number, opcional): Timeout em milissegundos, até `600000` (10 minutos). O padrão é `120000` (2 minutos).
- `run_in_background` (boolean, opcional): Quando `true`, o comando roda desanexado e você recebe uma notificação na conclusão. Não adicione `&` por conta própria.

## Exemplos

### Exemplo 1: Inspecionar o estado do repositório antes de commitar
Dispare `git status` e `git diff --stat` como duas chamadas `Bash` paralelas na mesma mensagem para coletar contexto rapidamente, depois monte o commit em uma chamada subsequente.

### Exemplo 2: Encadear passos de build dependentes
Use uma única chamada como `npm ci && npm run build && npm test` para que cada passo só rode após o anterior ter sucesso. Use `;` apenas se intencionalmente quiser que passos posteriores rodem mesmo após falhas.

### Exemplo 3: Dev server de longa duração
Invoque `npm run dev` com `run_in_background: true`. Você será notificado quando ele sair. Não faça polling com loops de `sleep`; diagnostique falhas em vez de repetir cegamente.

## Observações

- O diretório de trabalho persiste entre chamadas, mas o estado do shell (variáveis exportadas, funções de shell, aliases) não. Prefira caminhos absolutos e evite `cd` a menos que o usuário peça.
- Prefira ferramentas dedicadas em vez de equivalentes via pipe no shell: `Glob` em vez de `find`/`ls`, `Grep` em vez de `grep`/`rg`, `Read` em vez de `cat`/`head`/`tail`, `Edit` em vez de `sed`/`awk`, `Write` em vez de `echo >` ou heredocs, e texto comum do assistente em vez de `echo`/`printf` para saída dirigida ao usuário.
- Coloque entre aspas duplas qualquer caminho que contenha espaços (por exemplo `"/Users/me/My Project/file.txt"`).
- Para comandos independentes, faça múltiplas chamadas `Bash` em paralelo dentro de uma única mensagem. Só encadeie com `&&` quando um comando depende de outro.
- Saída acima de 30000 caracteres é truncada. Ao capturar logs grandes, redirecione para um arquivo e leia-o com a ferramenta `Read`.
- Nunca use flags interativas como `git rebase -i` ou `git add -i`; elas não podem receber entrada através desta ferramenta.
- Não pule git hooks (`--no-verify`, `--no-gpg-sign`) nem execute operações destrutivas (`reset --hard`, `push --force`, `clean -f`) a menos que o usuário peça explicitamente.
