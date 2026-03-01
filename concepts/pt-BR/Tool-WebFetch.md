# WebFetch

## Definição

Busca o conteúdo de uma URL especificada, converte HTML para markdown e processa o conteúdo usando um modelo de IA com base no prompt.

## Parâmetros

| Parâmetro | Tipo | Obrigatório | Descrição |
|------|------|------|------|
| `url` | string (URI) | Sim | URL completa a ser buscada |
| `prompt` | string | Sim | Descreve que informação extrair da página |

## Cenários de Uso

**Adequado para:**
- Obter conteúdo de páginas web públicas
- Consultar documentação online
- Extrair informações específicas de páginas web

**Não adequado para:**
- URLs que requerem autenticação (Google Docs, Confluence, Jira, GitHub, etc.) — deve primeiro procurar ferramentas MCP dedicadas
- URLs do GitHub — prefira usar o CLI `gh`

## Observações

- A URL deve ser uma URL válida completa
- HTTP é automaticamente atualizado para HTTPS
- Resultados podem ser resumidos quando o conteúdo é muito grande
- Inclui cache com auto-limpeza de 15 minutos
- Quando a URL redireciona para um host diferente, a ferramenta retorna a URL de redirecionamento, sendo necessário fazer nova requisição com a nova URL
- Se houver uma ferramenta web fetch fornecida por MCP disponível, prefira usá-la

## Significado no cc-viewer

As chamadas WebFetch aparecem nos logs de requisição como pares de content blocks `tool_use` / `tool_result`. O `tool_result` contém o resumo do conteúdo da página web processado por IA.

## Texto original

<textarea readonly>IMPORTANT: WebFetch WILL FAIL for authenticated or private URLs. Before using this tool, check if the URL points to an authenticated service (e.g. Google Docs, Confluence, Jira, GitHub). If so, you MUST use ToolSearch first to find a specialized tool that provides authenticated access.

- Fetches content from a specified URL and processes it using an AI model
- Takes a URL and a prompt as input
- Fetches the URL content, converts HTML to markdown
- Processes the content with the prompt using a small, fast model
- Returns the model's response about the content
- Use this tool when you need to retrieve and analyze web content

Usage notes:
  - IMPORTANT: If an MCP-provided web fetch tool is available, prefer using that tool instead of this one, as it may have fewer restrictions.
  - The URL must be a fully-formed valid URL
  - HTTP URLs will be automatically upgraded to HTTPS
  - The prompt should describe what information you want to extract from the page
  - This tool is read-only and does not modify any files
  - Results may be summarized if the content is very large
  - Includes a self-cleaning 15-minute cache for faster responses when repeatedly accessing the same URL
  - When a URL redirects to a different host, the tool will inform you and provide the redirect URL in a special format. You should then make a new WebFetch request with the redirect URL to fetch the content.
  - For GitHub URLs, prefer using the gh CLI via Bash instead (e.g., gh pr view, gh issue view, gh api).
</textarea>
