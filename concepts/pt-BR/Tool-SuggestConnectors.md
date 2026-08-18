# SuggestConnectors

Resolve payloads completos de conectores para valores `directoryUuid` retornados por `SearchMcpRegistry`, para que conectores concretos possam ser oferecidos ao usuário para habilitar.

## Quando usar

- Depois que `SearchMcpRegistry` retorna conectores candidatos, para buscar seus detalhes completos para apresentação.

## Ativação

- Disponível apenas em sessões remotas (claude.ai) na API first-party.

## Parâmetros

- `uuids` (array of strings, obrigatório): Valores `directoryUuid` ou `server_id` a resolver. 1–32 itens, cada um com 1–64 caracteres.

## Exemplos

### Exemplo 1: Resolver dois resultados do registro

```
SuggestConnectors(uuids=["d290f1ee-6c54-4b01-90e6-d701748f0851", "a1b2c3d4-0000-4000-8000-abcdefabcdef"])
```

## Observações

- Nunca adivinhe UUIDs — resolva apenas identificadores que vieram de `SearchMcpRegistry`.
- A ferramenta não conecta nada por si só; habilitar um conector acontece out of band.
