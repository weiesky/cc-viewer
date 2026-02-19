# CC-Viewer

Um sistema de monitoramento de requisições para Claude Code que captura e visualiza todas as requisições e respostas da API em tempo real. Ajuda desenvolvedores a monitorar o Context para revisão e depuração durante o Vibe Coding.

[简体中文](../README.md) | [English](./README.en.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Uso

```bash
npm install -g cc-viewer
```

Após a instalação, execute:

```bash
ccv
```

Este comando injeta automaticamente o script de monitoramento no Claude Code instalado localmente e adiciona um hook de reinjeção automática na configuração do seu shell (`~/.zshrc` ou `~/.bashrc`). Em seguida, use o Claude Code normalmente e abra `http://localhost:7008` no navegador para visualizar a interface de monitoramento.

Após a atualização do Claude Code, nenhuma ação manual é necessária — na próxima vez que você executar `claude`, ele detectará e reinjetará automaticamente.

### Desinstalar

```bash
ccv --uninstall
```

Limpa a injeção do cli.js e o hook de configuração do shell em uma única etapa.

## Funcionalidades

### Monitoramento de Requisições (Modo Raw)

- Captura em tempo real de todas as requisições da API do Claude Code, incluindo respostas em streaming
- Painel esquerdo mostra método da requisição, URL, duração e código de status
- Identifica e rotula automaticamente requisições do Main Agent e Sub Agent
- Painel direito suporta alternância entre abas Request / Response
- Request Body expande `messages`, `system`, `tools` um nível por padrão
- Response Body totalmente expandido por padrão
- Alternar entre visualização JSON e visualização em texto simples
- Cópia de conteúdo JSON com um clique
- Requisições MainAgent suportam Body Diff JSON, exibindo de forma recolhida as diferenças com a requisição MainAgent anterior (apenas campos alterados/adicionados)

### Modo Chat

Clique no botão "Modo Chat" no canto superior direito para analisar o histórico completo de conversas do Main Agent em uma interface de chat:

- Mensagens do usuário alinhadas à direita (bolhas azuis), respostas do Main Agent alinhadas à esquerda (bolhas escuras) com renderização Markdown
- Mensagens `/compact` detectadas automaticamente e exibidas recolhidas, clique para expandir o resumo completo
- Resultados de chamadas de ferramentas exibidos inline na mensagem do Assistant correspondente
- Blocos `thinking` recolhidos por padrão, clique para expandir
- `tool_use` exibido como cartões compactos de chamada de ferramenta (Bash, Read, Edit, Write, Glob, Grep, Task possuem exibições dedicadas)
- Mensagens de seleção do usuário (AskUserQuestion) exibidas em formato de perguntas e respostas
- Tags de injeção do sistema (`<system-reminder>`, `<project-reminder>`, etc.) recolhidas automaticamente
- Texto injetado pelo sistema filtrado automaticamente, mostrando apenas a entrada real do usuário
- Exibição segmentada por múltiplas sessões (segmentação automática após `/compact`, `/clear`, etc.)
- Cada mensagem exibe um timestamp com precisão de segundos

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
- Exportar prompts do usuário: extrair e exibir todas as entradas do usuário, com visualização recolhível de system-reminder
- Exportar prompts para TXT: exportar prompts do usuário para um arquivo `.txt` local

### Suporte Multilíngue

CC-Viewer suporta 18 idiomas, alternando automaticamente com base na localidade do sistema:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
