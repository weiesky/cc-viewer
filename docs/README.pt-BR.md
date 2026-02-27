# CC-Viewer

Sistema de monitoramento de requisições do Claude Code que captura e exibe visualmente todas as requisições e respostas da API do Claude Code em tempo real (texto bruto, sem censura). Prático para desenvolvedores monitorarem seu próprio Context, facilitando a revisão e depuração de problemas durante o Vibe Coding.

[English](../README.md) | [简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | Português (Brasil) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Como Usar

### Instalação

```bash
npm install -g cc-viewer
```

### Execução e Configuração Automática

```bash
ccv
```

Este comando detecta automaticamente o método de instalação local do Claude Code (NPM ou Native Install) e se adapta de acordo.

- **Instalação NPM**: Injeta automaticamente o script de interceptação no `cli.js` do Claude Code.
- **Native Install**: Detecta automaticamente o binário `claude`, configura um proxy transparente local e configura um Zsh Shell Hook para encaminhar o tráfego automaticamente.

### Substituição de Configuração (Configuration Override)

Se você precisar usar um endpoint de API personalizado (por exemplo, proxy corporativo), basta configurá-lo em `~/.claude/settings.json` ou definir a variável de ambiente `ANTHROPIC_BASE_URL`. O `ccv` reconhecerá automaticamente e encaminhará as requisições corretamente.

### Modo Silencioso (Silent Mode)

Por padrão, o `ccv` opera em modo silencioso ao envolver o `claude`, garantindo que a saída do terminal permaneça limpa e consistente com a experiência original. Todos os logs são capturados em segundo plano e podem ser visualizados em `http://localhost:7008`.

Após a configuração, use o comando `claude` normalmente. Acesse `http://localhost:7008` para visualizar a interface de monitoramento.

### Solução de Problemas (Troubleshooting)

- **Saída Mista (Mixed Output)**: Se você vir logs de depuração `[CC-Viewer]` misturados com a saída do Claude, atualize para a versão mais recente (`npm install -g cc-viewer`).
- **Conexão Recusada (Connection Refused)**: Certifique-se de que o processo em segundo plano `ccv` esteja em execução. Executar `ccv` ou `claude` (após a instalação do Hook) deve iniciá-lo automaticamente.
- **Corpo Vazio (Empty Body)**: Se você vir "No Body" no Viewer, pode ser devido a formatos SSE não padrão. O Viewer agora suporta a captura de conteúdo bruto como fallback.

### Desinstalação

```bash
ccv --uninstall
```

### Verificar Versão

```bash
ccv --version
```

## Funcionalidades

### Monitoramento de Requisições (Modo Texto Bruto)
<img width="1500" height="720" alt="image" src="https://github.com/user-attachments/assets/519dd496-68bd-4e76-84d7-2a3d14ae3f61" />
- Captura em tempo real todas as requisições da API do Claude Code, garantindo que seja texto bruto e não logs censurados (isso é importante!!!)
- Identifica e rotula automaticamente requisições do Main Agent e Sub Agent (subtipos: Bash, Task, Plan, General)
- Requisições MainAgent suportam Body Diff JSON, exibindo de forma recolhida as diferenças com a requisição MainAgent anterior (apenas campos alterados/adicionados)
- Cada requisição exibe inline estatísticas de uso de Token (tokens de entrada/saída, criação/leitura de cache, taxa de acerto)
- Compatível com Claude Code Router (CCR) e outros cenários de proxy — requisições são detectadas pelo padrão de caminho da API como fallback

### Modo Conversa

Clique no botão "Modo Conversa" no canto superior direito para analisar o histórico completo de conversas do Main Agent como uma interface de chat:
<img width="1500" height="730" alt="image" src="https://github.com/user-attachments/assets/c973f142-748b-403f-b2b7-31a5d81e33e6" />


- Ainda não suporta exibição de Agent Team
- Mensagens do usuário alinhadas à direita (bolhas azuis), respostas do Main Agent alinhadas à esquerda (bolhas escuras)
- Blocos `thinking` recolhidos por padrão, renderizados em Markdown, clique para expandir e ver o processo de pensamento; suporta tradução com um clique (funcionalidade ainda instável)
- Mensagens de seleção do usuário (AskUserQuestion) exibidas em formato de pergunta e resposta
- Sincronização bidirecional de modo: ao alternar para o modo conversa, navega automaticamente para a conversa correspondente à requisição selecionada; ao voltar para o modo texto bruto, navega automaticamente para a requisição selecionada
- Painel de configurações: permite alternar o estado padrão de recolhimento dos resultados de ferramentas e blocos de pensamento


### Ferramentas de Estatísticas

Painel flutuante "Estatísticas de Dados" na área do cabeçalho:
<img width="1500" height="729" alt="image" src="https://github.com/user-attachments/assets/b23f9a81-fc3d-4937-9700-e70d84e4e5ce" />

- Exibe contagens de cache creation/read e taxa de acerto de cache
- Estatísticas de reconstrução de cache: exibe contagens e tokens cache_creation agrupados por motivo (TTL, alterações de system/tools/model, truncamento/modificação de mensagens, alteração de key)
- Estatísticas de uso de ferramentas: exibe a frequência de uso de cada ferramenta ordenada por número de chamadas
- Estatísticas de uso de Skill: exibe a frequência de uso de cada Skill ordenada por número de chamadas
- Ícone de ajuda conceitual (?): clique para ver a documentação integrada do MainAgent, CacheRebuild e diversas ferramentas

### Gerenciamento de Logs

Através do menu suspenso CC-Viewer no canto superior esquerdo:
<img width="1200" height="672" alt="image" src="https://github.com/user-attachments/assets/8cf24f5b-9450-4790-b781-0cd074cd3b39" />

- Importar logs locais: navegar por arquivos de log históricos, agrupados por projeto, abrir em nova janela
- Carregar arquivo JSONL local: selecionar diretamente um arquivo `.jsonl` local para visualização (suporta até 500 MB)
- Salvar log atual como: baixar o arquivo de log JSONL de monitoramento atual
- Mesclar logs: mesclar vários arquivos de log JSONL em uma única sessão para análise unificada
- Ver Prompts do usuário: extrair e exibir todas as entradas do usuário, suporta três modos de visualização — modo Bruto (conteúdo original), modo Contexto (tags do sistema recolhíveis), modo Texto (texto puro); comandos slash (`/model`, `/context`, etc.) exibidos como entradas independentes; tags relacionadas a comandos automaticamente ocultadas do conteúdo do Prompt
- Exportar Prompts como TXT: exportar prompts do usuário (texto puro, sem tags do sistema) como arquivo `.txt` local

### Suporte Multilíngue

CC-Viewer suporta 18 idiomas, alternando automaticamente de acordo com o idioma do sistema:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
