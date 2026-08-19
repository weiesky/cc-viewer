# WebFetch

Recupera o conteúdo de uma página web pública, converte o HTML para Markdown e executa um pequeno modelo auxiliar sobre o resultado usando um prompt em linguagem natural para extrair a informação que você precisa.

## Quando usar

- Ler uma página de documentação pública, post de blog ou RFC referenciada na conversa.
- Extrair um fato específico, trecho de código ou tabela de uma URL conhecida sem carregar a página inteira no contexto.
- Resumir notas de release ou changelogs de um recurso web aberto.
- Verificar a referência pública de API de uma biblioteca quando a fonte não está no repositório local.
- Seguir um link que o usuário colou no chat para responder a uma pergunta de acompanhamento.

## Parâmetros

- `url` (string, obrigatório): Uma URL absoluta totalmente formada. `http://` puro é automaticamente atualizado para `https://`.
- `prompt` (string, obrigatório): A instrução passada ao pequeno modelo de extração. Descreva exatamente o que extrair da página, como "list all exported functions" ou "return the minimum supported Node version".

## Exemplos

### Exemplo 1: Extrair um padrão de configuração

```
WebFetch(
  url="https://vitejs.dev/config/server-options.html",
  prompt="What is the default value of server.port and can it be a string?"
)
```

A ferramenta busca a página de docs do Vite, converte para Markdown e retorna uma resposta curta como "Default is `5173`; accepts a number only."

### Exemplo 2: Resumir uma seção de changelog

```
WebFetch(
  url="https://nodejs.org/en/blog/release/v20.11.0",
  prompt="List the security fixes included in this release as bullet points."
)
```

Útil quando o usuário pergunta "o que mudou no Node 20.11" e a página de release é longa.

## Observações

- `WebFetch` falha em qualquer URL que exija autenticação, cookies ou VPN. Para Google Docs, Confluence, Jira, recursos privados do GitHub ou wikis internas, use um servidor MCP dedicado que forneça acesso autenticado em vez disso.
- Para qualquer coisa hospedada no GitHub (PRs, issues, blobs de arquivo, respostas de API), prefira a CLI `gh` via `Bash` em vez de raspar a UI web. `gh pr view`, `gh issue view` e `gh api` retornam dados estruturados e funcionam contra repositórios privados.
- Os resultados podem ser resumidos quando a página obtida é muito grande. Se precisar de texto exato, estreite o `prompt` para pedir um extrato literal.
- Um cache auto-limpante de 15 minutos é aplicado por URL. Chamadas repetidas para a mesma página durante uma sessão são quase instantâneas, mas podem retornar conteúdo ligeiramente defasado. Se a atualização importa, mencione isso no prompt ou espere o cache expirar.
- Se o host de destino emitir um redirect para outro host, a ferramenta retorna a nova URL em um bloco de resposta especial e não a segue automaticamente. Reinvoque `WebFetch` com o alvo do redirect se ainda quiser o conteúdo.
- O prompt é executado por um modelo menor e mais rápido que o assistente principal. Mantenha-o estreito e concreto; raciocínio complexo de múltiplos passos é melhor tratado lendo você mesmo o Markdown bruto após obtê-lo.
- Nunca passe segredos, tokens ou identificadores de sessão embutidos na URL — conteúdos de página e query strings refletidos na saída podem ser logados por serviços upstream.
