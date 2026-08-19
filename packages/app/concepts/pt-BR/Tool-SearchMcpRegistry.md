# SearchMcpRegistry

Busca o registro de conectores MCP por palavra-chave para descobrir conectores que possam ajudar a concluir a tarefa.

## Quando usar

- A tarefa se beneficiaria de um serviço externo (um banco de dados, um rastreador de issues, uma API SaaS) e você quer verificar se existe um conector MCP para ele.
- O usuário nomeia um produto e pede para conectá-lo — busque no registro por um conector correspondente.

## Ativação

- Disponível apenas em sessões remotas (claude.ai) na API first-party.

## Parâmetros

- `keywords` (array of strings, obrigatório): Frases-chave descrevendo a intenção do usuário ou um produto nomeado. 1–8 itens, cada um com 1–64 caracteres.

## Exemplos

### Exemplo 1: Encontrar um conector para um produto nomeado

```
SearchMcpRegistry(keywords=["linear", "issue tracker"])
```

Retorna entradas do registro cujos conectores correspondem às palavras-chave. Resolva os detalhes completos do conector com `SuggestConnectors`.

## Observações

- Somente leitura e seguro para concorrência; os resultados têm tamanho limitado.
- Buscar não instala nada — é puramente descoberta.
