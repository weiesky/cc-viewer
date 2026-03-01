# WebSearch

## Definição

Executa consultas em mecanismo de busca, retornando resultados de pesquisa para obter informações atualizadas.

## Parâmetros

| Parâmetro | Tipo | Obrigatório | Descrição |
|------|------|------|------|
| `query` | string | Sim | Consulta de busca (mínimo 2 caracteres) |
| `allowed_domains` | string[] | Não | Incluir apenas resultados destes domínios |
| `blocked_domains` | string[] | Não | Excluir resultados destes domínios |

## Cenários de Uso

**Adequado para:**
- Obter informações atualizadas além da data de corte do conhecimento do modelo
- Buscar eventos atuais e dados recentes
- Pesquisar documentação técnica mais recente

## Observações

- Os resultados de busca são retornados em formato de hyperlinks markdown
- Após o uso, é obrigatório incluir uma seção "Sources:" no final da resposta, listando as URLs relevantes
- Suporta filtragem de domínios (inclusão/exclusão)
- A consulta de busca deve usar o ano atual
- Disponível apenas nos EUA

## Significado no cc-viewer

As chamadas WebSearch aparecem nos logs de requisição como pares de content blocks `tool_use` / `tool_result`. O `tool_result` contém a lista de resultados da busca.

## Texto original

<textarea readonly>
- Allows Claude to search the web and use the results to inform responses
- Provides up-to-date information for current events and recent data
- Returns search result information formatted as search result blocks, including links as markdown hyperlinks
- Use this tool for accessing information beyond Claude's knowledge cutoff
- Searches are performed automatically within a single API call

CRITICAL REQUIREMENT - You MUST follow this:
  - After answering the user's question, you MUST include a "Sources:" section at the end of your response
  - In the Sources section, list all relevant URLs from the search results as markdown hyperlinks: [Title](URL)
  - This is MANDATORY - never skip including sources in your response
  - Example format:

    [Your answer here]

    Sources:
    - [Source Title 1](https://example.com/1)
    - [Source Title 2](https://example.com/2)

Usage notes:
  - Domain filtering is supported to include or block specific websites
  - Web search is only available in the US

IMPORTANT - Use the correct year in search queries:
  - The current month is March 2026. You MUST use this year when searching for recent information, documentation, or current events.
  - Example: If the user asks for "latest React docs", search for "React documentation" with the current year, NOT last year
</textarea>
