# CC-Viewer

Sistema de monitoramento de requisicoes do Claude Code que captura e visualiza em tempo real todas as requisicoes e respostas de API (texto original, sem censura). Facilita para os desenvolvedores monitorarem seu proprio Context, permitindo revisao e depuracao de problemas durante o Vibe Coding.
A versao mais recente do CC-Viewer tambem oferece solucoes para programacao web com deploy em servidor, alem de ferramentas para programacao mobile. Todos sao bem-vindos a usar em seus proprios projetos. No futuro, mais funcionalidades de plugins e suporte a deploy em nuvem serao disponibilizados.

Primeiro, a parte interessante — veja o que voce pode fazer no celular:

<img width="1700" height="790" alt="image" src="https://github.com/user-attachments/assets/da3e519f-ff66-4cd2-81d1-f4e131215f6c" />

[English](../README.md) | [简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | Português (Brasil) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Como Usar

### Instalacao

```bash
npm install -g cc-viewer --registry=https://registry.npmjs.org
```

### Modo Programacao

ccv e um substituto direto do claude. Todos os parametros sao repassados ao claude, enquanto o Web Viewer e iniciado simultaneamente.

```bash
ccv                    # == claude (modo interativo)
ccv -c                 # == claude --continue (continuar ultima conversa)
ccv -r                 # == claude --resume (retomar conversa)
ccv -p "hello"         # == claude --print "hello" (modo impressao)
ccv --d                # == claude --dangerously-skip-permissions (atalho)
ccv --model opus       # == claude --model opus
```

O comando mais usado pelo autor e:
```
ccv -c --d             # == claude --continue --dangerously-skip-permissions
```

Apos iniciar o modo programacao, a pagina web sera aberta automaticamente.

Voce pode usar o claude diretamente na pagina web, alem de visualizar as mensagens completas das requisicoes e verificar alteracoes no codigo.

E melhor ainda — voce pode ate programar pelo celular!


### Modo Logger

⚠️ Se voce ainda prefere usar a ferramenta nativa do claude ou o plugin do VS Code, use este modo.

Neste modo, ao iniciar ```claude``` ou ```claude --dangerously-skip-permissions```

um processo de log sera iniciado automaticamente, registrando os logs de requisicoes em ~/.claude/cc-viewer/*seuprojeto*/data.jsonl

Iniciar o modo logger:
```bash
ccv -logger
```

Quando a porta especifica nao pode ser exibida no console, a porta padrao da primeira instancia e 127.0.0.1:7008. Instancias simultaneas usam portas sequenciais como 7009, 7010.

Este comando detecta automaticamente o metodo de instalacao do Claude Code (NPM ou Native Install) e se adapta de acordo.

- **Versao NPM do claude code**: Injeta automaticamente um script interceptador no `cli.js` do Claude Code.
- **Versao Native do claude code**: Detecta automaticamente o binario `claude`, configura um proxy transparente local e configura um Zsh Shell Hook para redirecionamento automatico de trafego.
- Este projeto recomenda o uso do Claude Code instalado via NPM.

Desinstalar o modo logger:
```bash
ccv --uninstall
```

### Solucao de Problemas (Troubleshooting)

Se voce encontrar problemas na inicializacao, existe uma solucao definitiva:
Passo 1: Abra o Claude Code em qualquer diretorio;
Passo 2: De ao Claude Code a seguinte instrucao:
```
Eu instalei o pacote npm cc-viewer, mas apos executar ccv ele ainda nao funciona corretamente. Verifique cli.js e findcc.js do cc-viewer e adapte o deploy local do Claude Code de acordo com o ambiente especifico. Limite as alteracoes ao findcc.js na medida do possivel.
```
Deixar o Claude Code verificar os erros por conta propria e mais eficaz do que consultar qualquer pessoa ou ler qualquer documentacao!

Apos a conclusao das instrucoes acima, o findcc.js sera atualizado. Se seu projeto frequentemente precisa de deploy local, ou se o codigo forkado precisa resolver problemas de instalacao com frequencia, basta manter este arquivo e copia-lo diretamente na proxima vez. Atualmente, muitos projetos e empresas nao fazem deploy do Claude Code no Mac, mas sim em servidores hospedados. Por isso, o autor separou o findcc.js para facilitar o acompanhamento das atualizacoes do codigo-fonte do cc-viewer.

### Outros Comandos Auxiliares

Consultar:
```bash
ccv -h
```

### Substituicao de Configuracao (Configuration Override)

Se voce precisar usar um endpoint de API personalizado (por exemplo, proxy corporativo), basta configurar em `~/.claude/settings.json` ou definir a variavel de ambiente `ANTHROPIC_BASE_URL`. O `ccv` detectara automaticamente e encaminhara as requisicoes corretamente.

### Modo Silencioso (Silent Mode)

Por padrao, o `ccv` roda em modo silencioso ao envolver o `claude`, garantindo que a saida do terminal permaneca limpa e identica a experiencia nativa. Todos os logs sao capturados em segundo plano e podem ser visualizados em `http://localhost:7008`.

Apos a configuracao, use o comando `claude` normalmente. Acesse `http://localhost:7008` para ver a interface de monitoramento.


## Versao Client

O CC-Viewer oferece uma versao client para desktop que pode ser baixada no GitHub:
[Link para download](https://github.com/weiesky/cc-viewer/releases)
A versao client esta atualmente em fase de testes; caso encontre algum problema, fique a vontade para nos dar feedback. Alem disso, o uso do cc-viewer requer que o Claude Code esteja instalado localmente.
E importante observar que o cc-viewer e apenas uma "roupa" para o trabalhador (Claude Code). Sem o Claude Code, a roupa nao consegue funcionar sozinha.


## Funcionalidades


### Modo Programacao

Apos iniciar com ccv, voce vera:

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/ab353a2b-f101-409d-a28c-6a4e41571ea2" />


Voce pode visualizar o diff do codigo diretamente apos a edicao:

<img width="1500" height="728" alt="image" src="https://github.com/user-attachments/assets/2a4acdaa-fc5f-4dc0-9e5f-f3273f0849b2" />

Embora seja possivel abrir arquivos e programar manualmente, isso nao e recomendado — isso e programacao a moda antiga!

### Programacao Mobile

Voce pode ate escanear um QR code para programar no celular:

<img width="3018" height="1460" alt="image" src="https://github.com/user-attachments/assets/8debf48e-daec-420c-b37a-609f8b81cd20" />

Realize suas expectativas de programacao mobile. Alem disso, ha um mecanismo de plugins — se voce quiser personalizar sua experiencia de programacao, pode acompanhar as atualizacoes dos hooks de plugins.

**Entrada por voz**: toque no icone do microfone na entrada do chat para ditado por voz (Web Speech API; requer HTTPS ou localhost, portanto o botao e ocultado no acesso LAN HTTP). No Android, use a tecla 🎤 integrada do Gboard; no iOS, o ditado do sistema no teclado — ambos funcionam offline e sem HTTPS.

### Modo Logger (visualizar conversas completas do Claude Code)

<img width="1500" height="768" alt="image" src="https://github.com/user-attachments/assets/a8a9f3f7-d876-4f6b-a64d-f323a05c4d21" />


- Captura em tempo real todas as requisicoes de API enviadas pelo Claude Code, garantindo que seja o texto original e nao logs censurados (isso e muito importante!!!)
- Identifica e marca automaticamente requisicoes Main Agent e Sub Agent (subtipos: Plan, Search, Bash)
- Requisicoes MainAgent suportam Body Diff JSON, exibindo as diferencas em relacao a requisicao MainAgent anterior de forma recolhida (mostrando apenas campos alterados/novos)
- Cada requisicao exibe estatisticas de uso de Token inline (Token de entrada/saida, criacao/leitura de cache, taxa de acerto)
- Compativel com Claude Code Router (CCR) e outros cenarios de proxy — faz correspondencia de requisicoes via padrao de caminho de API como fallback

### Modo Conversa

Clique no botao "Modo Conversa" no canto superior direito para analisar o historico completo de conversas do Main Agent como uma interface de chat:

<img width="1500" height="764" alt="image" src="https://github.com/user-attachments/assets/725b57c8-6128-4225-b157-7dba2738b1c6" />


- Ainda nao suporta exibicao de Agent Team
- Mensagens do usuario alinhadas a direita (bolha azul), respostas do Main Agent alinhadas a esquerda (bolha escura)
- Blocos `thinking` recolhidos por padrao, renderizados em Markdown. Clique para expandir e ver o processo de raciocinio; suporta traducao com um clique (funcionalidade ainda instavel)
- Mensagens de selecao do usuario (AskUserQuestion) exibidas em formato de pergunta e resposta
- Sincronizacao bidirecional de modo: ao alternar para o modo conversa, navega automaticamente para a conversa da requisicao selecionada; ao voltar ao modo original, navega automaticamente para a requisicao selecionada
- Painel de configuracoes: permite alternar o estado padrao de recolhimento de resultados de ferramentas e blocos thinking
- Visualizacao de conversa mobile: no modo CLI mobile, clique no botao "Visualizacao de Conversa" na barra superior para abrir uma visualizacao somente leitura e navegar pelo historico completo de conversas no celular

### Ferramentas de Estatisticas

Painel flutuante "Estatisticas de Dados" na area do header:

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/a3d2db47-eac3-463a-9b44-3fa64994bf3b" />

- Exibe contagem de cache creation/read e taxa de acerto do cache
- Estatisticas de reconstrucao de cache: agrupadas por motivo (TTL, alteracao de system/tools/model, truncamento/modificacao de mensagem, alteracao de key) com contagem e cache_creation tokens
- Estatisticas de uso de ferramentas: exibe frequencia de chamadas de cada ferramenta, ordenada por quantidade
- Estatisticas de uso de Skill: exibe frequencia de chamadas de cada Skill, ordenada por quantidade
- Suporta estatisticas de teammate
- Icones de ajuda conceitual (?): clique para ver a documentacao integrada para MainAgent, CacheRebuild e cada ferramenta

### Gerenciamento de Logs

Atraves do menu dropdown CC-Viewer no canto superior esquerdo:
<img width="1500" height="760" alt="image" src="https://github.com/user-attachments/assets/33295e2b-f2e0-4968-a6f1-6f3d1404454e" />

**Compressao de Logs**
Sobre os logs, o autor precisa esclarecer que nenhuma modificacao foi feita nas definicoes oficiais da Anthropic, garantindo a integridade dos logs.
Porem, como os logs individuais do opus 1M ficam extremamente grandes ao longo do tempo, gracas as otimizacoes de log implementadas pelo autor para o MainAgent, e possivel reduzir o tamanho em pelo menos 66% sem gzip.
O metodo para analisar esses logs comprimidos pode ser extraido deste repositorio.

### Mais Funcionalidades Uteis

<img width="1500" height="767" alt="image" src="https://github.com/user-attachments/assets/add558c5-9c4d-468a-ac6f-d8d64759fdbd" />

Voce pode localizar rapidamente seu prompt pela barra lateral

--- 

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/82b8eb67-82f5-41b1-89d6-341c95a047ed" />

O interessante KV-Cache-Text permite que voce veja o que o Claude realmente esta vendo

---

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/54cdfa4e-677c-4aed-a5bb-5fd946600c46" />

Voce pode fazer upload de imagens e descrever suas necessidades. O Claude tem uma capacidade de compreensao de imagens muito poderosa. Voce tambem pode colar capturas de tela diretamente com Ctrl + V, e a conversa exibira todo o seu conteudo

---

<img width="600" height="370" alt="image" src="https://github.com/user-attachments/assets/87d332ea-3e34-4957-b442-f9d070211fbf" />

Voce pode personalizar plugins diretamente, gerenciar todos os processos do CC-Viewer, e o CC-Viewer possui a capacidade de troca rapida para APIs de terceiros (sim, voce pode usar GLM, Kimi, MiniMax, Qwen, DeepSeek — embora o autor acredite que todos eles ainda sao bastante fracos no momento)

---


<img width="1500" height="746" alt="image" src="https://github.com/user-attachments/assets/b1f60c7c-1438-4ecc-8c64-193d21ee3445" />

Mais funcionalidades esperando para serem descobertas... Por exemplo: o sistema suporta Agent Team e possui Code Reviewer integrado. Em breve vira a integracao com o Code Reviewer do Codex (o autor e um grande defensor de usar o Codex para fazer review de codigo do Claude Code)


### Atualizacoes Automaticas

O CC-Viewer verifica atualizacoes automaticamente na inicializacao (no maximo uma vez a cada 4 horas). Dentro da mesma versao principal (ex: 1.x.x -> 1.y.z) atualiza automaticamente, entrando em vigor na proxima inicializacao. Na mudanca de versao principal, apenas uma notificacao e exibida.

A atualizacao automatica segue a configuracao global do Claude Code `~/.claude/settings.json`. Se o Claude Code desativou atualizacoes automaticas (`autoUpdates: false`), o CC-Viewer tambem pula a atualizacao automatica.

### Suporte Multilingue

O CC-Viewer suporta 18 idiomas e alterna automaticamente com base no idioma do sistema:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
