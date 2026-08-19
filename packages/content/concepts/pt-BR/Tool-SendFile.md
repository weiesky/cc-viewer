# SendFile

Envia um ou mais arquivos para outra sessão do Claude Code — um par listado por `ListAgents`, ou um endereço de sessão explícito.

## Quando usar

- Uma sessão par precisa de um arquivo do seu diretório de trabalho (um relatório, um patch, uma fixture) para continuar sua própria tarefa.
- Você está coordenando trabalho entre sessões e quer entregar artefatos, não apenas texto (use `SendMessage` para texto).

## Ativação

- A transferência de arquivos entre sessões deve estar disponível na sessão; quando não está, a validação falha com "Cross-session file transfer is not available in this session."
- Gated pelas mesmas condições de mensagens entre sessões que `ListAgents` (feature flags do lado do servidor, desativadas por padrão).

## Parâmetros

- `to` (string, obrigatório): Destinatário — um nome de sessão par de `ListAgents`, ou um endereço explícito `uds:<socket>` / `bridge:<session id>`.
- `files` (array of strings, obrigatório): Caminhos de arquivo (absolutos ou relativos ao cwd) a enviar. Sempre passe um array, mesmo para um único arquivo. 1–16 arquivos, no máximo 30 MiB cada.
- `message` (string, opcional): Mensagem curta entregue junto com os arquivos.

## Exemplos

### Exemplo 1: Enviar um relatório para uma sessão par

```
SendFile(
  to="teammate-a",
  files=["./dist/report.html"],
  message="The analysis you asked for"
)
```

## Observações

- Transferências para máquinas remotas podem exigir aprovação adicional.
- Ler o conteúdo dos arquivos faz parte do envio — negado se leituras de arquivo estiverem desabilitadas por regras de permissão.
