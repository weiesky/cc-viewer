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

Este comando configura automaticamente o Claude Code instalado localmente para monitoramento e adiciona um hook de reparo automático na configuração do seu shell (`~/.zshrc` ou `~/.bashrc`). Em seguida, use o Claude Code normalmente e abra `http://localhost:7008` no navegador para visualizar a interface de monitoramento.

Após a atualização do Claude Code, nenhuma ação manual é necessária — na próxima vez que você executar `claude`, ele detectará e reconfigurará automaticamente.

### Desinstalar

```bash
ccv --uninstall
```

## Funcionalidades

### Monitoramento de Requisições (Modo Raw)

- Captura em tempo real de todas as requisições da API do Claude Code, incluindo respostas em streaming
- Painel esquerdo mostra método da requisição, URL, duração e código de status
- Identifica e rotula automaticamente requisições do Main Agent e Sub Agent (subtipos: Bash, Task, Plan, General)
- Painel direito suporta alternância entre abas Request / Response
- Request Body expande `messages`, `system`, `tools` um nível por padrão
- Response Body totalmente expandido por padrão
- Alternar entre visualização JSON e visualização em texto simples
- Cópia de conteúdo JSON com um clique
- Requisições MainAgent suportam Body Diff JSON, exibindo de forma recolhida as diferenças com a requisição MainAgent anterior (apenas campos alterados/adicionados)
- O tooltip do Body Diff JSON pode ser fechado; uma vez fechado, a preferência é salva no servidor e nunca mais exibida
- Estatísticas de uso de Token inline por requisição (tokens de entrada/saída, criação/leitura de cache, taxa de acerto)

### Modo Chat

Clique no botão "Modo Chat" no canto superior direito para analisar o histórico completo de conversas do Main Agent em uma interface de chat:

- Mensagens do usuário alinhadas à direita (bolhas azuis), respostas do Main Agent alinhadas à esquerda (bolhas escuras) com renderização Markdown
- Mensagens `/compact` detectadas automaticamente e exibidas recolhidas, clique para expandir o resumo completo
- Resultados de chamadas de ferramentas exibidos inline na mensagem do Assistant correspondente
- Blocos `thinking` recolhidos por padrão, renderizados como Markdown, clique para expandir
- `tool_use` exibido como cartões compactos de chamada de ferramenta (Bash, Read, Edit, Write, Glob, Grep, Task possuem exibições dedicadas)
- Resultados de ferramentas Task (SubAgent) renderizados como Markdown
- Mensagens de seleção do usuário (AskUserQuestion) exibidas em formato de perguntas e respostas
- Tags do sistema (`<system-reminder>`, `<project-reminder>`, etc.) recolhidas automaticamente
- Mensagens de carregamento de Skill detectadas automaticamente e recolhidas, exibindo o nome do Skill; clique para expandir a documentação completa (renderização Markdown)
- Texto do sistema filtrado automaticamente, mostrando apenas a entrada real do usuário
- Exibição segmentada por múltiplas sessões (segmentação automática após `/compact`, `/clear`, etc.)
- Cada mensagem exibe um timestamp com precisão de segundos, derivado do timing da requisição API
- Painel de configurações: alternar o estado de recolhimento padrão para resultados de ferramentas e blocos de pensamento

### Estatísticas de Token

Painel flutuante na área do cabeçalho:

- Contagem de Token agrupada por modelo (input/output)
- Contagens de Cache creation/read e taxa de acerto de cache
- Contagem regressiva de expiração do cache do Main Agent

### Gerenciamento de Logs

Através do menu suspenso CC-Viewer no canto superior esquerdo:

- Importar logs locais: navegar por arquivos de log históricos, agrupados por projeto, abre em nova janela
- Carregar arquivo JSONL local: selecionar e carregar diretamente um arquivo `.jsonl` local (até 200MB)
- Baixar log atual: baixar o arquivo de log JSONL de monitoramento atual
- Exportar prompts do usuário: extrair e exibir todas as entradas do usuário, com tags XML (system-reminder, etc.) recolhíveis; comandos slash (`/model`, `/context`, etc.) exibidos como entradas independentes; tags relacionadas a comandos ocultadas automaticamente do conteúdo do prompt
- Exportar prompts para TXT: exportar prompts do usuário (somente texto, excluindo tags do sistema) para um arquivo `.txt` local

### Suporte Multilíngue

CC-Viewer suporta 18 idiomas, alternando automaticamente com base na localidade do sistema:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
