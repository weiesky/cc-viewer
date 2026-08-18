# ListMcpResources

Lista os recursos expostos por servidores MCP conectados, opcionalmente filtrados para um servidor.

## Quando usar

- Você precisa descobrir quais recursos (arquivos, registros, documentos) um servidor MCP oferece antes de lê-los.
- Você quer uma visão geral de todos os recursos em todos os servidores conectados.

## Ativação

- Sempre habilitado, mas não exposto à lista de ferramentas do modelo — destinado ao uso thin-client / sidecar.

## Parâmetros

- `server` (string, opcional): Nome do servidor pelo qual filtrar os recursos. Omita para listar recursos de todos os servidores conectados.

## Exemplos

### Exemplo 1: Listar tudo

```
ListMcpResources()
```

### Exemplo 2: Listar os recursos de um servidor

```
ListMcpResources(server="github")
```

## Observações

- Esta é a etapa de descoberta: alimente URIs interessantes em `ReadMcpResource` (recurso único) ou `ReadMcpResourceDir` (listagens de diretório).
- Servidores conectam e desconectam ao longo da vida da sessão; liste novamente se um servidor acabou de ser adicionado.
