# CC-Viewer

Um sistema de monitoramento de requisições para Claude Code que captura e visualiza todas as requisições e respostas da API em tempo real. Ajuda desenvolvedores a monitorar o Context para revisão e depuração durante o Vibe Coding.

[简体中文](./README.zh.md) | [English](../README.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Uso

```bash
npm install -g cc-viewer
```

Após a instalação, execute:

```bash
ccv
```

Este comando detecta automaticamente o método de instalação local do Claude Code (NPM ou Native Install) e se adapta.

- **Instalação NPM**: Injeta automaticamente o script interceptor no `cli.js` do Claude Code.
- **Native Install**: Detecta automaticamente o binário `claude`, configura um proxy transparente local e configura um Hook Shell Zsh para rotear o tráfego automaticamente.

### Substituição de Configuração (Configuration Override)

Se você precisar usar um endpoint de API personalizado (por exemplo, proxy corporativo), basta configurá-lo em `~/.claude/settings.json` ou definir a variável de ambiente `ANTHROPIC_BASE_URL`. O `ccv` reconhecerá automaticamente essas configurações e encaminhará as solicitações corretamente.

### Modo Silencioso (Silent Mode)

Por padrão, o `ccv` é executado no modo silencioso ao envolver o `claude`, garantindo que a saída do terminal permaneça limpa e idêntica à experiência original do Claude Code. Todos os logs são capturados em segundo plano e visíveis em `http://localhost:7008`.

Em seguida, use o Claude Code normalmente e abra `http://localhost:7008` no navegador para visualizar a interface de monitoramento.

### Solução de Problemas (Troubleshooting)

- **Saída Mista (Mixed Output)**: Se você vir logs de depuração do `[CC-Viewer]` misturados com a saída do Claude, atualize para a versão mais recente (`npm install -g cc-viewer`).
- **Conexão Recusada (Connection Refused)**: Certifique-se de que o processo em segundo plano `ccv` esteja em execução. Executar `ccv` ou `claude` (após a instalação do hook) deve iniciá-lo automaticamente.
- **Corpo Vazio (Empty Body)**: Se você vir "No Body" no visualizador, pode ser devido a formatos SSE não padrão. O visualizador agora suporta a captura de conteúdo bruto como fallback.

### Verificar Versão (Check Version)

```bash
ccv --version
```

### Desinstalar

```bash
ccv --uninstall
```

## Funcionalidades

### Monitoramento de Requisições (Modo Raw)

- Captura em tempo real de todas as requisições da API do Claude Code, incluindo respostas em streaming
- Painel esquerdo mostra método da requisição, URL, duração e código de status
- Identifica e rotula automaticamente requisições do Main Agent e Sub Agent (subtipos: Bash, Task, Plan, General)
- A lista de requisições rola automaticamente até o item selecionado (centralizado na troca de modo, mais próximo no clique manual)
- Painel direito suporta alternância entre abas Request / Response
- Request Body expande `messages`, `system`, `tools` um nível por padrão
- Response Body totalmente expandido por padrão
- Alternar entre visualização JSON e visualização em texto simples
- Cópia de conteúdo JSON com um clique
- Requisições MainAgent suportam Body Diff JSON, exibindo de forma recolhida as diferenças com a requisição MainAgent anterior (apenas campos alterados/adicionados)
- A seção Diff suporta alternância entre visualização JSON/Texto e cópia com um clique
- Configuração "Expandir Diff": quando ativada, as requisições do MainAgent expandem automaticamente a seção diff
- O tooltip do Body Diff JSON pode ser fechado; uma vez fechado, a preferência é salva no servidor e nunca mais exibida
- Headers sensíveis (`x-api-key`, `authorization`) são automaticamente mascarados nos arquivos de log JSONL para prevenir vazamento de credenciais
- Estatísticas de uso de Token inline por requisição (tokens de entrada/saída, criação/leitura de cache, taxa de acerto)
- Compatível com Claude Code Router (CCR) e outras configurações de proxy — as requisições são detectadas pelo padrão de caminho da API como fallback

### Modo Chat

Clique no botão "Modo Chat" no canto superior direito para analisar o histórico completo de conversas do Main Agent em uma interface de chat:

- Mensagens do usuário alinhadas à direita (bolhas azuis), respostas do Main Agent alinhadas à esquerda (bolhas escuras) com renderização Markdown
- Mensagens `/compact` detectadas automaticamente e exibidas recolhidas, clique para expandir o resumo completo
- Resultados de chamadas de ferramentas exibidos inline na mensagem do Assistant correspondente
- Blocos `thinking` recolhidos por padrão, renderizados como Markdown, clique para expandir; suporte a tradução com um clique
- `tool_use` exibido como cartões compactos de chamada de ferramenta (Bash, Read, Edit, Write, Glob, Grep, Task possuem exibições dedicadas)
- Resultados de ferramentas Task (SubAgent) renderizados como Markdown
- Mensagens de seleção do usuário (AskUserQuestion) exibidas em formato de perguntas e respostas
- Tags do sistema (`<system-reminder>`, `<project-reminder>`, etc.) recolhidas automaticamente
- Mensagens de carregamento de Skill detectadas automaticamente e recolhidas, exibindo o nome do Skill; clique para expandir a documentação completa (renderização Markdown)
- Skills reminder detectado automaticamente e recolhido
- Texto do sistema filtrado automaticamente, mostrando apenas a entrada real do usuário
- Exibição segmentada por múltiplas sessões (segmentação automática após `/compact`, `/clear`, etc.)
- Cada mensagem exibe um timestamp com precisão de segundos, derivado do timing da requisição API
- Cada mensagem possui um link "Ver requisição" para voltar ao modo raw na requisição API correspondente
- Sincronização bidirecional de modos: ao mudar para o modo chat, rola até a conversa correspondente à requisição selecionada; ao voltar, rola até a requisição selecionada
- Painel de configurações: alternar o estado de recolhimento padrão para resultados de ferramentas e blocos de pensamento
- Configurações globais: alternar filtragem de solicitações irrelevantes (count_tokens, heartbeat)

### Tradução

- Blocos thinking e mensagens do Assistant suportam tradução com um clique
- Baseado na API Claude Haiku, usa apenas autenticação `x-api-key` (tokens de sessão OAuth são excluídos para prevenir poluição de contexto)
- Captura automaticamente o nome do modelo haiku das requisições mainAgent; padrão `claude-haiku-4-5-20251001`
- Resultados de tradução são armazenados em cache automaticamente; clique novamente para voltar ao texto original
- Animação de carregamento durante a tradução
- O ícone (?) ao lado do header `authorization` nos detalhes da requisição leva ao documento conceitual sobre poluição de contexto

### Estatísticas de Token

Painel flutuante na área do cabeçalho:

- Contagem de Token agrupada por modelo (input/output)
- Contagens de Cache creation/read e taxa de acerto de cache
- Estatísticas de reconstrução de cache agrupadas por motivo (TTL, alteração de system/tools/model, truncamento/modificação de mensagens, alteração de chave) com contagem e tokens de cache_creation
- Estatísticas de uso de ferramentas: contagem de chamadas por ferramenta, ordenadas por frequência
- Estatísticas de uso de Skills: frequência de chamadas por Skill, ordenadas por frequência
- Ícones de ajuda conceitual (?): clique para visualizar a documentação integrada do MainAgent, CacheRebuild e cada ferramenta
- Contagem regressiva de expiração do cache do Main Agent

### Gerenciamento de Logs

Através do menu suspenso CC-Viewer no canto superior esquerdo:

- Importar logs locais: navegar por arquivos de log históricos, agrupados por projeto, abre em nova janela
- Carregar arquivo JSONL local: selecionar e carregar diretamente um arquivo `.jsonl` local (até 500MB)
- Baixar log atual: baixar o arquivo de log JSONL de monitoramento atual
- Mesclar logs: combinar vários arquivos de log JSONL em uma única sessão para análise unificada
- Ver Prompts do usuário: extrair e exibir todas as entradas do usuário com três modos de visualização — modo Original (conteúdo bruto), modo Contexto (tags do sistema recolhíveis), modo Texto (apenas texto simples); comandos slash (`/model`, `/context`, etc.) exibidos como entradas independentes; tags relacionadas a comandos automaticamente ocultadas do conteúdo do Prompt
- Exportar prompts para TXT: exportar prompts do usuário (somente texto, excluindo tags do sistema) para um arquivo `.txt` local

### Suporte Multilíngue

CC-Viewer suporta 18 idiomas, alternando automaticamente com base na localidade do sistema:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
