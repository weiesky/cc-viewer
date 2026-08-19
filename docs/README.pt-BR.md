# CC-Viewer

🌐 **Site e tour de recursos: [weiesky.github.io/cc-viewer](https://weiesky.github.io/cc-viewer/)** — disponível em 18 idiomas.


Um kit de ferramentas de Vibe Coding destilado da própria experiência de desenvolvimento, construído sobre Claude Code:

1. Elevar o limite das capacidades: execute /ultraPlan e /ultraReview localmente, para que o código do seu projeto nunca precise estar totalmente exposto à nuvem do Claude;
2. Compatibilidade multiplataforma: permite a programação móvel (dentro da LAN); a versão web se adapta a diversos cenários, fácil de incorporar em extensões de navegador e visualizações divididas do sistema operacional, e fornece um instalador nativo;
3. Registro completo: oferece capacidades completas de interceptação e análise do payload do Claude Code, ideal para registro, análise de problemas, aprendizado, inspiração e engenharia reversa;
4. Aprendizado e experiência compartilhados: foram acumulados inúmeros materiais de estudo e experiências de desenvolvimento (veja os ícones "?" em todo o sistema);
5. Experiência nativa preservada: apenas amplia as capacidades do Claude Code, sem modificações substanciais ao núcleo, mantendo a experiência nativa;
6. Suporte a modelos de terceiros: compatível com deepseek-v4-\*, GLM 5.1, Kimi K2.6, com a capacidade cc-switch integrada para alternar a quente entre ferramentas de terceiros a qualquer momento. O diálogo de alternância a quente também suporta fontes por função — Main Agent, Sub-Agents e Teammates podem usar cada um um perfil de proxy diferente (padrão: seguir o Main Agent); quando o Main Agent usa o Default integrado com o endpoint oficial, a atribuição de funções permanece oculta e inativa.

<img width="860" alt="cc-viewer — deploy once, share with every device" src="https://raw.githubusercontent.com/weiesky/cc-viewer/main/docs/cc-viewer-share.svg" />

[English](../README.md) | [简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | Português (Brasil) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Uso

### Pré-requisitos

* Certifique-se de ter o Node.js 20.0.0+ instalado; [Baixar e instalar](https://nodejs.org)
* Certifique-se de ter o Claude Code instalado; [Tutorial de instalação](https://github.com/anthropics/claude-code)

### Instalar ccv

#### Instalação via npm

```bash
npm install -g cc-viewer --registry=https://registry.npmjs.org
```

#### Instalação via Homebrew (recomendado para macOS / Linux)

```bash
brew tap weiesky/cc-viewer
brew install cc-viewer
brew upgrade cc-viewer   # para atualizações — NÃO use npm install -g com instalações brew
```

#### Instalação via pnpm (global)

```bash
pnpm add -g cc-viewer
pnpm add -g cc-viewer@latest   # para atualizações — NÃO use npm install -g com instalações pnpm
```

### Inicialização

ccv é um substituto direto do claude — todos os argumentos são repassados para o claude enquanto o Web Viewer é iniciado.

```bash
ccv                    # == claude (modo interativo)
```

O comando que o próprio autor usa com mais frequência é:

```
ccv -c --d             # == claude --continue --dangerously-skip-permissions
                       # ccv repassa todos os parâmetros de inicialização do Claude Code — você pode combiná-los como quiser
```

Após iniciar no modo de programação, uma página web será aberta automaticamente.

cc-viewer também é distribuído como aplicativo desktop nativo: [Página de download](https://github.com/weiesky/cc-viewer/releases)

### Atualização para 1.7.0 (formato de log v2)

A partir da 1.7.0, os logs são armazenados em um formato de diretório por sessão (wire-format v2) em vez de arquivos `.jsonl` individuais — ocupando cerca de 90% menos espaço em disco. Os arquivos `.jsonl` v1 existentes nunca são modificados nem excluídos; a caixa de diálogo de logs lista as sessões v2 por padrão, e uma pequena entrada “Ver logs legados (v1)” (exibida enquanto houver arquivos antigos) abre uma visualização v1 onde podem ser visualizados, migrados ou excluídos. Na inicialização, o cc-viewer oferece migração com um clique quando encontra logs legados (altamente recomendada ao continuar uma conversa antiga com `claude -c`, cuja primeira metade fica nos arquivos antigos). Você também pode migrar pelo terminal:

```bash
ccv convert <project>   # migrar um projeto
ccv convert --all       # migrar todos os projetos
ccv verify <v1-file>    # verificar um arquivo v1 em relação às suas sessões convertidas
```

Se uma sessão não passar na verificação golden, ela é retida em `sessions-quarantine/` para inspeção em vez de fazer toda a migração falhar — as demais sessões são migradas normalmente.

### Modo Logger

Se você ainda prefere a ferramenta nativa claude ou a extensão do VS Code, use este modo.

Neste modo, iniciar `claude`

iniciará automaticamente um processo de registro que salva os logs de solicitações em diretórios por sessão dentro de \~/.claude/cc-viewer/*yourproject*/sessions/ (wire-format v2)

Ativar o modo logger:

```bash
ccv -logger
```

Quando o console não pode imprimir a porta específica, a primeira porta padrão é 127.0.0.1:7008. Instâncias múltiplas usam portas sequenciais como 7009, 7010.

Desinstalar o modo logger:

```bash
ccv --uninstall
```

### Solução de problemas (Troubleshooting)

Se você encontrar problemas ao iniciar o cc-viewer, aqui está a abordagem definitiva para solução de problemas:
Passo 1: Abra o Claude Code em qualquer diretório.
Passo 2: Dê ao Claude Code a seguinte instrução:

```
Eu instalei o pacote npm cc-viewer, mas após executar ccv ainda não funciona corretamente. Por favor, verifique cli.js e findcc.js do cc-viewer e adapte-os ao deployment local do Claude Code com base no ambiente específico. Mantenha o escopo das alterações o mais restrito possível dentro do findcc.js.
```

Deixar o Claude Code diagnosticar o problema sozinho é mais eficaz do que perguntar a qualquer pessoa ou ler qualquer documentação!

Depois que a instrução acima for concluída, o findcc.js será atualizado. Se o seu projeto requer frequentemente deployment local, ou se o código forkado precisa frequentemente resolver problemas de instalação, manter este arquivo permite que você simplesmente o copie da próxima vez. No momento, muitos projetos e empresas que usam Claude Code não estão fazendo deployment no Mac, mas sim em ambientes hospedados no lado do servidor, então o autor separou o arquivo findcc.js para facilitar o acompanhamento das atualizações do código-fonte do cc-viewer no futuro.

Nota: este aplicativo entra em conflito com claude-code-switch e claude-code-router devido à concorrência de proxy, portanto, ao usá-lo, certifique-se de fechar claude-code-switch e claude-code-router. cc-viewer inclui uma capacidade de atualização a quente de proxy como substituto equivalente.

### Outros comandos auxiliares

Consulte:

```bash
ccv -h
```

### Modo silencioso (Silent Mode)

Por padrão, `ccv` é executado em modo silencioso ao envolver `claude`, mantendo a saída do terminal limpa e consistente com a experiência nativa. Todos os logs são capturados em segundo plano e podem ser visualizados em `http://localhost:7008`.

Uma vez configurado, use o comando `claude` normalmente. Visite `http://localhost:7008` para acessar a interface de monitoramento.

## Recursos

### Modo Programação

Após iniciar com ccv, você pode ver:

<img height="765" width="1500" alt="image" src="https://github.com/user-attachments/assets/ab353a2b-f101-409d-a28c-6a4e41571ea2" />

Você pode ver as diferenças de código diretamente após editar:

<img height="728" width="1500" alt="image" src="https://github.com/user-attachments/assets/2a4acdaa-fc5f-4dc0-9e5f-f3273f0849b2" />

Embora você possa abrir arquivos e programar manualmente, a programação manual não é recomendada — isso é programação antiquada!

### Programação móvel

Você pode até escanear um código QR para programar a partir do seu dispositivo móvel:

<img height="1460" width="3018" alt="image" src="https://github.com/user-attachments/assets/8debf48e-daec-420c-b37a-609f8b81cd20" />

<img height="790" width="1700" alt="image" src="https://github.com/user-attachments/assets/da3e519f-ff66-4cd2-81d1-f4e131215f6c" />

Realize sua imaginação sobre programação móvel. Também há um mecanismo de plugins — se precisar personalizar para seus hábitos de programação, fique atento às atualizações dos hooks de plugins.

### Prompts de sistema por modelo

O modal **Editar prompt do sistema** (menu de hambúrguer → Editar prompt do sistema) é organizado em abas:

* A aba **Padrão** mantém o comportamento clássico: grava `CC_SYSTEM.md` (sobrescrever) ou `CC_APPEND_SYSTEM.md` (acrescentar) no espaço de trabalho atual, injetado como `--system-prompt-file` / `--append-system-prompt-file` na próxima inicialização do ccv.
* **Abas de modelo**: clique em **+ Adicionar modelo**, digite um nome como `opus` ou `Gemini3` e escolha um escopo — **Global** (`~/.claude/cc-viewer/system_prompt/`, aplica-se a todos os espaços de trabalho) ou **Espaço de trabalho** (`<project>/system_prompt/`). O campo de nome oferece sugestões conforme você digita, a partir dos seus modelos configurados localmente (perfis de proxy com recarga automática e `settings.json`); nomes já adicionados no escopo escolhido ficam ocultos, e nomes livres arbitrários continuam permitidos. Cada aba tem seu próprio interruptor Acrescentar/Sobrescrever e sua própria pré-visualização de Markdown.
* As entradas são armazenadas como arquivos em maiúsculas: `OPUS_SYSTEM.md` (sobrescrever) ou `OPUS_APPEND_SYSTEM.md` (acrescentar). A correspondência é difusa — uma substring, sem distinção entre maiúsculas e minúsculas, do ID do modelo resolvido a partir da configuração ATIVA (mapeamento de modelo do proxy profile de terceiros ativo > variáveis de ambiente `ANTHROPIC_MODEL`/`CLAUDE_MODEL` na inicialização > `model` do `settings.json`; sem sinal de configuração nenhuma entrada é injetada), então `opus` corresponde a `claude-opus-4-8[1m]` independentemente da versão. Uma correspondência de espaço de trabalho prevalece sobre uma global; dentro de um escopo, vence o nome mais longo; uma entrada correspondente substitui completamente os arquivos de Padrão para essa inicialização. Limitações conhecidas: trocar de proxy profile no meio da sessão só é reavaliado após reiniciar a sessão do claude; um `--model` passado por argumentos extras não é consultado.
* Salvar uma aba vazia exclui a entrada. Trocas de modelo feitas no meio da sessão são aplicadas na próxima reinicialização. Defina `CCV_DISABLE_AUTO_SYSTEM_PROMPT=1` para desativar toda injeção automática. Você pode fazer commit de `<project>/system_prompt/` para compartilhar prompts com sua equipe, ou adicioná-lo ao `.gitignore` para mantê-los privados.

### Modo Logger (Visualizar sessões completas do Claude Code)

<img width="860" alt="cc-viewer — wire-level capture and packet decomposition" src="https://raw.githubusercontent.com/weiesky/cc-viewer/main/docs/cc-viewer-proxy.svg" />

* Captura todas as solicitações de API do Claude Code em tempo real, garantindo o texto bruto — não logs censurados (isso é importante!!!)
* Identifica e marca automaticamente as solicitações Main Agent e Sub Agent (subtipos: Plan, Search, Bash)
* As solicitações MainAgent suportam Body Diff JSON, mostrando diferenças recolhidas em relação à solicitação MainAgent anterior (apenas campos modificados/novos)
* Cada solicitação exibe estatísticas de uso de Token em linha (Tokens de entrada/saída, criação/leitura de cache, taxa de acerto)
* Compatível com Claude Code Router (CCR) e outros cenários de proxy — recorre ao padrão de caminho da API

<a href="https://www.star-history.com/?repos=weiesky%2Fcc-viewer&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=weiesky/cc-viewer&type=date&theme=dark&legend=top-left" />

    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=weiesky/cc-viewer&type=date&legend=top-left" />

    ![Star History Chart](https://api.star-history.com/chart?repos=weiesky/cc-viewer&type=date&legend=top-left)
  </picture>
</a>

## License

MIT
