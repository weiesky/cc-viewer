# ListPlugins

Lista os plugins do claude.ai habilitados do usuário, opcionalmente filtrados por palavra-chave.

## Quando usar

- Você precisa saber quais plugins já estão habilitados — por exemplo, para confirmar o que foi instalado após um card de `SuggestPluginInstall`.
- O usuário pergunta quais plugins ele tem.

## Ativação

- Requer permissão de acesso ao registro de plugins.
- A disponibilidade depende do tipo de sessão e do rollout do recurso — desabilitado em ambientes HIPAA, sempre disponível em sessões remotas.

## Parâmetros

- `keywords` (array of strings, opcional): Filtra a lista — até 8 itens, cada um com 1–64 caracteres. Omita para listar tudo.

## Exemplos

### Exemplo 1: Listar plugins habilitados

```
ListPlugins()
```

### Exemplo 2: Filtrar por palavra-chave

```
ListPlugins(keywords=["figma"])
```

## Observações

- Se o catálogo de plugins estiver inacessível (forbidden), a ferramenta degrada para uma lista vazia com um aviso em vez de falhar.
