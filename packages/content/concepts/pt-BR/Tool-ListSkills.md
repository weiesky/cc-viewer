# ListSkills

Lista as skills do claude.ai habilitadas do usuário, opcionalmente filtradas por palavra-chave.

## Quando usar

- Você precisa da lista autoritativa de skills atualmente habilitadas — antes de invocar uma, ou para confirmar o que um card de `SuggestSkills` adicionou.
- O usuário pergunta quais skills ele tem.

## Ativação

- Requer permissão de acesso ao registro de plugins.
- Desabilitado em ambientes HIPAA.
- Sempre disponível em sessões remotas.

## Parâmetros

- `keywords` (array of strings, opcional): Filtra a lista — até 8 itens, cada um com 1–64 caracteres. Omita para listar tudo.

## Exemplos

### Exemplo 1: Listar skills habilitadas

```
ListSkills()
```

### Exemplo 2: Filtrar por palavra-chave

```
ListSkills(keywords=["review"])
```

## Observações

- Se o catálogo estiver inacessível (forbidden), a ferramenta degrada para uma lista vazia com um aviso em vez de falhar.
- Isto lista skills *habilitadas*; use `SuggestSkills` para trazer à tona skills que o usuário poderia adicionar.
