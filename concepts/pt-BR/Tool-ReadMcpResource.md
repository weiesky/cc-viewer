# ReadMcpResource

Lê um único recurso exposto por um servidor MCP (Model Context Protocol) conectado, endereçado por sua URI.

## Quando usar

- Um servidor MCP anuncia um recurso (arquivo, registro, documento) cujo conteúdo você precisa no contexto.
- Você tem uma URI de recurso concreta — de `ListMcpResources`, da documentação do servidor ou de um resultado de ferramenta anterior.

## Ativação

- Sempre habilitado, mas não exposto à lista de ferramentas do modelo — destinado ao uso thin-client / sidecar.

## Parâmetros

- `server` (string, obrigatório): O nome do servidor MCP.
- `uri` (string, obrigatório): A URI do recurso a ler.

## Exemplos

### Exemplo 1: Ler um recurso de servidor por URI

```
ReadMcpResource(server="github", uri="file:///repo/docs/architecture.md")
```

Retorna o conteúdo do recurso conforme fornecido pelo servidor MCP `github`.

## Observações

- Use `ListMcpResources` primeiro se você não sabe quais recursos um servidor expõe; use `ReadMcpResourceDir` para listagens em estilo de diretório.
- O esquema de URI é específico do servidor (`file://`, `https://`, esquemas customizados) — verifique o que o servidor alvo anuncia.
