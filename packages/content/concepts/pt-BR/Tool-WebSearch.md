# WebSearch

Executa uma busca na web em tempo real e retorna resultados ranqueados que o assistente usa para embasar sua resposta em informação atual além do ponto de corte do treinamento do modelo.

## Quando usar

- Responder perguntas sobre eventos atuais, releases recentes ou notícias de última hora.
- Buscar a versão mais recente de uma biblioteca, framework ou ferramenta CLI.
- Encontrar documentação ou posts de blog quando a URL exata é desconhecida.
- Verificar um fato que pode ter mudado desde que o modelo foi treinado.
- Descobrir múltiplas perspectivas sobre um tópico antes de obter qualquer página única com `WebFetch`.

## Ativação

- A disponibilidade depende do provedor e do modelo: disponível na API da Anthropic e no Claude Platform on AWS; no Microsoft Foundry requer um deployment hospedado pela Anthropic; no Google Cloud funciona com modelos Claude 4+.
- Não disponível no Amazon Bedrock.
- Limite de 200 chamadas por sessão com `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION`.

## Parâmetros

- `query` (string, obrigatório): A consulta de busca. Comprimento mínimo de 2 caracteres. Inclua o ano atual ao perguntar sobre informação "mais recente" ou "recente" para que os resultados sejam atuais.
- `allowed_domains` (array of strings, opcional): Restringe resultados apenas a esses domínios, por exemplo `["nodejs.org", "developer.mozilla.org"]`. Útil quando você confia em uma fonte específica.
- `blocked_domains` (array of strings, opcional): Exclui resultados desses domínios. Não passe o mesmo domínio em ambos `allowed_domains` e `blocked_domains`.

## Exemplos

### Exemplo 1: Consulta de versão com ano atual

```
WebSearch(
  query="React 19 stable release date 2026",
  allowed_domains=["react.dev", "github.com"]
)
```

Retorna anúncios oficiais e evita sites agregadores de baixa qualidade.

### Exemplo 2: Excluir fontes ruidosas

```
WebSearch(
  query="kubernetes ingress-nginx CVE April 2026",
  blocked_domains=["pinterest.com", "medium.com"]
)
```

Mantém os resultados focados em avisos de fornecedores e rastreadores de segurança.

## Observações

- Quando você usa `WebSearch` em uma resposta, deve adicionar uma seção `Sources:` ao final da sua resposta listando cada resultado citado como um hiperlink Markdown no formato `[Title](URL)`. Este é um requisito rígido, não opcional.
- `WebSearch` está disponível apenas para usuários nos Estados Unidos. Se a ferramenta não estiver disponível em sua região, recorra a `WebFetch` contra uma URL conhecida ou peça ao usuário para colar conteúdo relevante.
- Cada chamada executa a busca em uma única ida e volta — você não pode fazer stream ou paginar. Refine a query se o primeiro conjunto de resultados estiver fora do alvo.
- A ferramenta retorna snippets e metadata, não conteúdo completo da página. Para ler um resultado específico em profundidade, siga com `WebFetch` usando a URL retornada.
- Use `allowed_domains` para forçar fonte autorizada para perguntas sensíveis à segurança, como CVEs ou compliance, e `blocked_domains` para cortar fazendas de SEO que espelham documentação.
- Mantenha queries curtas e baseadas em palavras-chave. Perguntas em linguagem natural funcionam, mas tendem a retornar respostas conversacionais em vez de fontes primárias.
- Não invente URLs com base em intuição de busca — sempre rode a busca e cite o que a ferramenta realmente retornou.
