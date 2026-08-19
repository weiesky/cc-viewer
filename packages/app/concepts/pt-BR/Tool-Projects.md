# Projects

Gerencia documentos do projeto na base de conhecimento do projeto Claude do usuário: ler, buscar, escrever e excluir docs, ou obter informações do projeto.

## Quando usar

- Persistir um documento (entregável, notas, material de referência) no projeto do usuário para que ele sobreviva à sessão.
- Ler ou buscar docs existentes do projeto para fundamentar a tarefa atual em contexto prévio.
- Enviar um arquivo local para o projeto sem carregar seu conteúdo no contexto.
- Remover um doc de projeto desatualizado.

## Parâmetros

- `method` (string, obrigatório): Um de `project_info`, `project_read`, `project_search`, `project_write`, `project_delete`.
- `path` (string, opcional): Para `project_read`/`project_write`/`project_delete`: o caminho do doc. Para `project_write`: um caminho existente é substituído no lugar; um novo nome de arquivo simples (sem "/") recebe o namespace `claude/<name>`.
- `content` (string, opcional): Para `project_write`: texto do doc inline. Mutuamente exclusivo com `local_path`.
- `local_path` (string, opcional): Para `project_write`: um arquivo dentro do diretório de trabalho para enviar — o conteúdo nunca entra no seu contexto. Mutuamente exclusivo com `content`.
- `present_to_user` (boolean, opcional): Para `project_write`: marcar este doc como o entregável que o usuário precisa ver. O padrão é false; deixe indefinido para salvamentos de rotina e escritas em massa.
- `query` (string, opcional): Para `project_search`: consulta da base de conhecimento.
- `n` (number, opcional): Para `project_search`: número de resultados (padrão 5).

## Exemplos

### Exemplo 1: Escrever o entregável no projeto

```
Projects(
  method="project_write",
  path="claude/migration-plan.md",
  local_path="./migration-plan.md",
  present_to_user=true
)
```

Envia o arquivo local sem puxar seu conteúdo para o contexto e o sinaliza como entregável do usuário.

### Exemplo 2: Buscar na base de conhecimento

```
Projects(method="project_search", query="authentication refresh tokens", n=5)
```

## Observações

- `content` é para texto que você compõe inline; `local_path` é para qualquer coisa que já esteja em disco — nunca misture os dois.
- Use `present_to_user=true` com moderação: apenas para o único doc que o usuário pediu ou sobre o qual deve agir.
