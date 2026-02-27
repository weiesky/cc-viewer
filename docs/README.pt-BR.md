# CC-Viewer

Sistema de monitoramento de requisições do Claude Code que captura e visualiza em tempo real todas as requisições e respostas de API do Claude Code (texto original, sem cortes). Facilita o monitoramento do contexto pelos desenvolvedores para revisão e resolução de problemas durante o processo de Vibe Coding.

[English](../README.md) | [繁體中文](./README.zh-TW.md) | [简体中文](./README.zh.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | Português (Brasil) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Como usar

### Instalação

```bash
npm install -g cc-viewer
```

### Execução e configuração automática

```bash
ccv
```

Este comando detecta automaticamente o método de instalação do Claude Code local (NPM ou Native Install) e se adapta a ele.

- **Instalação NPM**: injeta automaticamente o script de interceptação no `cli.js` do Claude Code.
- **Native Install**: detecta automaticamente o binário `claude`, configura um proxy transparente local e define um Zsh Shell Hook para encaminhar o tráfego automaticamente.

### Substituição de configuração (Configuration Override)

Se você precisar usar um endpoint de API personalizado (por exemplo, um proxy corporativo), basta configurá-lo em `~/.claude/settings.json` ou definir a variável de ambiente `ANTHROPIC_BASE_URL`. O `ccv` reconhecerá automaticamente e encaminhará as requisições corretamente.

### Modo silencioso (Silent Mode)

Por padrão, o `ccv` opera em modo silencioso ao envolver o `claude`, garantindo que a saída do terminal permaneça limpa e consistente com a experiência nativa. Todos os logs são capturados em segundo plano e podem ser visualizados em `http://localhost:7008`.

Após a configuração, use o comando `claude` normalmente. Acesse `http://localhost:7008` para visualizar a interface de monitoramento.

### Solução de problemas (Troubleshooting)

Se você encontrar problemas de inicialização, existe uma solução definitiva:
Passo 1: abra o Claude Code em qualquer diretório;
Passo 2: dê a seguinte instrução ao Claude Code:
```
Eu instalei o pacote npm cc-viewer, mas depois de executar ccv ele ainda não funciona corretamente. Verifique o cli.js e o findcc.js do cc-viewer e adapte ao método de implantação local do Claude Code com base no ambiente específico. Tente manter o escopo das alterações dentro do findcc.js.
```
Deixar o próprio Claude Code verificar os erros é mais eficaz do que perguntar a qualquer pessoa ou consultar qualquer documentação!

Após concluir as instruções acima, o findcc.js será atualizado. Se o seu projeto frequentemente requer implantação local, ou se o código bifurcado precisa resolver problemas de instalação com frequência, basta manter este arquivo. Da próxima vez, copie o arquivo diretamente. Atualmente, muitos projetos e empresas que usam Claude Code não fazem implantação no Mac, mas sim em servidores, por isso o autor separou o arquivo findcc.js para facilitar o acompanhamento das atualizações do código-fonte do cc-viewer.

### Desinstalação

```bash
ccv --uninstall
```

### Verificar versão

```bash
ccv --version
```

## Funcionalidades

### Monitoramento de requisições (modo texto original)
<img width="1500" height="720" alt="image" src="https://github.com/user-attachments/assets/519dd496-68bd-4e76-84d7-2a3d14ae3f61" />
- Captura em tempo real todas as requisições de API enviadas pelo Claude Code, garantindo que sejam o texto original e não logs truncados (isso é muito importante!!!)
- Identifica e marca automaticamente requisições do Main Agent e Sub Agent (subtipos: Bash, Task, Plan, General)
- Requisições do MainAgent suportam Body Diff JSON, exibindo de forma recolhida as diferenças em relação à requisição anterior do MainAgent (mostra apenas campos alterados/adicionados)
- Exibe estatísticas de uso de tokens inline para cada requisição (tokens de entrada/saída, criação/leitura de cache, taxa de acerto)
- Compatível com Claude Code Router (CCR) e outros cenários de proxy — correspondência de requisições por padrão de caminho de API como fallback

### Modo de conversa

Clique no botão "Modo de conversa" no canto superior direito para analisar o histórico completo de conversas do Main Agent em uma interface de chat:
<img width="1500" height="730" alt="image" src="https://github.com/user-attachments/assets/c973f142-748b-403f-b2b7-31a5d81e33e6" />


- Exibição do Agent Team ainda não suportada
- Mensagens do usuário alinhadas à direita (balão azul), respostas do Main Agent alinhadas à esquerda (balão escuro)
- Blocos `thinking` recolhidos por padrão, renderizados em Markdown, clique para expandir e ver o processo de raciocínio; suporte a tradução com um clique (funcionalidade ainda instável)
- Mensagens de seleção do usuário (AskUserQuestion) exibidas em formato de pergunta e resposta
- Sincronização bidirecional de modos: ao alternar para o modo de conversa, localiza automaticamente a conversa correspondente à requisição selecionada; ao voltar para o modo de texto original, localiza automaticamente a requisição selecionada
- Painel de configurações: permite alternar o estado de recolhimento padrão dos resultados de ferramentas e blocos de raciocínio


### Ferramentas de estatísticas

Painel flutuante "Estatísticas de dados" na área do cabeçalho:
<img width="1500" height="729" alt="image" src="https://github.com/user-attachments/assets/b23f9a81-fc3d-4937-9700-e70d84e4e5ce" />

- Exibe quantidade de criação/leitura de cache e taxa de acerto de cache
- Estatísticas de reconstrução de cache: agrupadas por motivo (TTL, alteração de system/tools/model, truncamento/modificação de mensagens, alteração de key), mostrando contagem e tokens de cache_creation
- Estatísticas de uso de ferramentas: exibe a frequência de chamadas de cada ferramenta ordenada por número de chamadas
- Estatísticas de uso de Skill: exibe a frequência de chamadas de cada Skill ordenada por número de chamadas
- Ícone de ajuda conceitual (?): clique para ver a documentação integrada do MainAgent, CacheRebuild e diversas ferramentas

### Gerenciamento de logs

Através do menu suspenso CC-Viewer no canto superior esquerdo:
<img width="1200" height="672" alt="image" src="https://github.com/user-attachments/assets/8cf24f5b-9450-4790-b781-0cd074cd3b39" />

- Importar logs locais: navegar por arquivos de log históricos, agrupados por projeto, abrir em nova janela
- Carregar arquivo JSONL local: selecionar diretamente um arquivo `.jsonl` local para visualização (suporta até 500 MB)
- Salvar log atual como: baixar o arquivo de log JSONL de monitoramento atual
- Mesclar logs: mesclar vários arquivos de log JSONL em uma única sessão para análise unificada
- Ver Prompts do usuário: extrair e exibir todas as entradas do usuário, suporta três modos de visualização — modo Bruto (conteúdo original), modo Contexto (tags do sistema recolhíveis), modo Texto (texto puro); comandos slash (`/model`, `/context`, etc.) exibidos como entradas independentes; tags relacionadas a comandos automaticamente ocultadas do conteúdo do Prompt
- Exportar Prompts como TXT: exportar prompts do usuário (texto puro, sem tags do sistema) como arquivo `.txt` local

### Suporte multilíngue

CC-Viewer suporta 18 idiomas, alternando automaticamente de acordo com o idioma do sistema:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
