# systemPromptModel.md variables

Este arquivo documenta apenas as variáveis em `systemPromptModel.md` que devem ser resolvidas em tempo de execução. Cada variável de folha é resolvida como uma string, um número ou uma string vazia `""`; quando um valor não pode ser obtido, ele volta uniformemente para uma string vazia.

## Espaço de trabalho e ambiente do usuário

| Variable | Description | Example |
|---|---|---|
| `${environment.cwd}` | Diretório de trabalho primário atual. | `/Users/sky/claude-code` |
| `${environment.originalCwd}` | Diretório de trabalho original quando o processo/sessão começou. | `/Users/sky/claude-code` |
| `${environment.home}` | Diretório home do usuário, usado para resolver `~`. | `/Users/sky` |
| `${environment.user}` | Nome de usuário do sistema atual. | `sky` |
| `${environment.workspaceRoots}` | Raízes do espaço de trabalho para a sessão atual; pode ser renderizado como uma string separada por quebras de linha. | `/Users/sky/claude-code` |
| `${environment.path}` | PATH do processo atual. | `/opt/homebrew/bin:/usr/bin:/bin` |
| `${environment.lang}` | Localidade ou ambiente de idioma atual. | `zh_CN.UTF-8` |

## Sistema operacional

| Variable | Description | Example |
|---|---|---|
| `${os.platform}` | Plataforma identificada pelo Node.js. | `darwin` |
| `${os.type}` | Tipo do sistema operacional. | `Darwin` |
| `${os.arch}` | Arquitetura da CPU. | `arm64` |
| `${os.shell}` | Shell atual. | `/bin/zsh` |
| `${os.version}` | Descrição da versão do sistema operacional. | `Darwin Kernel Version ...` |
| `${os.release}` | Versão do sistema operacional. | `24.5.0` |
| `${os.hostname}` | Nome de host atual. | `MacBook-Pro.local` |
| `${os.availableParallelism}` | Paralelismo disponível. | `10` |
| `${os.totalMemory}` | Memória total do sistema, em bytes. | `34359738368` |
| `${os.freeMemory}` | Memória livre, em bytes. | `8589934592` |
| `${os.uptime}` | Tempo de atividade do sistema, em segundos. | `123456` |

## Runtime Node.js

| Variable | Description | Example |
|---|---|---|
| `${runtime.nodeVersion}` | Versão atual do Node.js. | `v24.14.0` |
| `${runtime.execPath}` | Caminho para o executável Node.js atual. | `/opt/homebrew/bin/node` |
| `${runtime.pid}` | ID do processo atual. | `12345` |
| `${runtime.ppid}` | ID do processo pai. | `1234` |

## Hora

| Variable | Description | Example |
|---|---|---|
| `${time.current}` | String de hora local atual. | `Thu Jul 09 2026 18:22:09 GMT+0800 (China Standard Time)` |
| `${time.iso}` | Hora ISO atual. | `2026-07-09T10:22:09.000Z` |
| `${time.date}` | Data local atual. | `2026-07-09` |
| `${time.timezone}` | Fuso horário do sistema atual. | `Asia/Shanghai` |

## Permissões e sandbox

| Variable | Description | Example |
|---|---|---|
| `${permissions.mode}` | Modo de permissão da ferramenta atual. | `default` |
| `${permissions.approvalsReviewer}` | Política de aprovação ou modo de revisor atual. | `auto_review` |
| `${sandbox.mode}` | Modo de sandbox do sistema de arquivos. | `workspace-write` |
| `${sandbox.networkAccess}` | Status de acesso à rede. | `enabled` |
| `${sandbox.writableRoots}` | Diretórios aos quais o sandbox permite escrita; pode ser renderizado como uma string separada por quebras de linha. | `/Users/sky/Documents/Playground` |

## Terminal

| Variable | Description | Example |
|---|---|---|
| `${terminal.term}` | TERM atual. | `xterm-256color` |
| `${terminal.colorTerm}` | COLORTERM atual. | `truecolor` |
| `${terminal.columns}` | Contagem de colunas do terminal atual. | `120` |
| `${terminal.rows}` | Contagem de linhas do terminal atual. | `40` |

## Sistema de arquivos

| Variable | Description | Example |
|---|---|---|
| `${filesystem.tmpdir}` | Diretório temporário do sistema. | `/var/folders/.../T` |
| `${filesystem.pathSeparator}` | Separador de caminho de arquivo. | `/` |
| `${filesystem.pathDelimiter}` | Delimitador de entrada PATH. | `:` |

## Modelo

| Variable | Description | Example |
|---|---|---|
| `${model.name}` | Nome ou ID do modelo atual. | `claude-opus-4-6` |
| `${model.knowledgeCutoff}` | Limite de conhecimento do modelo atual; este valor não pode ser derivado do sistema operacional e deve ser injetado através de configuração externa ou uma substituição. | `May 2025` |

## Git

| Variable | Description | Example |
|---|---|---|
| `${git.isRepository}` | Se o diretório atual está dentro de um repositório git, como uma string. | `true` |
| `${git.root}` | Diretório raiz do repositório git. | `/Users/sky/project` |
| `${git.branch}` | Branch git atual ou hash HEAD curto. | `main` |
| `${git.mainBranch}` | Branch principal padrão, normalmente usado como alvo de PR ou mesclagem. | `main` |
| `${git.userName}` | `user.name` do git atual. | `Sky` |
| `${git.status}` | Saída de `git status --short`. | `M src/index.ts` |
| `${git.recentCommits}` | Resumo de commits recentes. | `abc1234 Fix prompt builder` |

## Memória

As variáveis de memória descrevem o diretório de memória persistente baseado em arquivos. `${memory.dir}` é resolvido a partir da substituição `CC_MEMORY_DIR` / `CLAUDE_MEMORY_DIR` quando definida; caso contrário, é calculado como `<home>/.claude/projects/<slug>/memory/`, onde `<slug>` é o diretório de trabalho principal com cada caractere não alfanumérico substituído por `-`. `${memory.index}` contém o conteúdo de `MEMORY.md` nesse diretório (o índice carregado a cada sessão), e `${memory.enabled}` informa se a memória está disponível. As seções `# Memory` e `# Memory index` são montadas apenas quando a memória está habilitada.

| Variable | Description | Example |
|---|---|---|
| `${memory.dir}` | Diretório de memória resolvido. | `/Users/sky/.claude/projects/-Users-sky-project/memory/` |
| `${memory.index}` | Conteúdo de `MEMORY.md`, ou `""` quando ausente. | `# Memory index\n- [Commit to main](commit-to-main.md) — hook` |
| `${memory.enabled}` | Se a memória está disponível, como uma string. | `true` |

## Scratchpad

O diretório scratchpad é específico da sessão e não pode ser derivado do sistema operacional; deve ser injetado através da substituição `CC_SCRATCHPAD_DIR` / `CLAUDE_SCRATCHPAD_DIR`. Quando não definido, ele volta para `""`, e a seção `# Scratchpad Directory` é omitida da montagem.

| Variable | Description | Example |
|---|---|---|
| `${scratchpad.dir}` | Diretório temporário específico da sessão. | `/private/tmp/claude-501/<slug>/<session>/scratchpad` |
