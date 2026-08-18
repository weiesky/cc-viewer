# ReadMcpResourceDir

Lista as entradas de um recurso em estilo de diretório exposto por um servidor MCP conectado, endereçado por sua URI.

## Quando usar

- Um servidor MCP organiza recursos hierarquicamente e você precisa enumerar um nível dessa hierarquia.
- Você quer navegar antes de ler recursos individuais com `ReadMcpResource`.

## Ativação

- Sempre habilitado, mas não exposto à lista de ferramentas do modelo — destinado ao uso thin-client / sidecar.

## Parâmetros

- `server` (string, obrigatório): O nome do servidor MCP.
- `uri` (string, obrigatório): A URI do recurso de diretório a listar.

## Exemplos

### Exemplo 1: Listar um diretório de recursos

```
ReadMcpResourceDir(server="filesystem", uri="file:///project/src/")
```

Retorna as entradas filhas que o servidor expõe sob aquela URI de diretório.

## Observações

- Apenas servidores que modelam seus recursos como diretórios suportam isso; servidores planos retornarão um erro ou uma listagem vazia — recorra a `ListMcpResources`.
- Combine com `ReadMcpResource` para aprofundar nas entradas que parecerem relevantes.
