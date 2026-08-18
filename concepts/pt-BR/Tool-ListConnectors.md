# ListConnectors

Lista os conectores MCP instalados para a organização claude.ai do usuário, opcionalmente filtrados por palavra-chave.

## Quando usar

- Você precisa saber quais conectores já estão instalados antes de sugerir novos.
- O usuário pergunta quais integrações a organização dele tem.

## Ativação

- Disponível apenas em sessões remotas (claude.ai) na API first-party.

## Parâmetros

- `keywords` (array of strings, opcional): Filtra a lista — até 8 itens, cada um com 1–64 caracteres. Omita para listar tudo.

## Exemplos

### Exemplo 1: Listar todos os conectores instalados

```
ListConnectors()
```

### Exemplo 2: Filtrar por palavra-chave

```
ListConnectors(keywords=["github"])
```

## Observações

- Combine com `SearchMcpRegistry` (descoberta) e `SuggestConnectors` (detalhes) para o fluxo completo de encontrar-e-habilitar.
