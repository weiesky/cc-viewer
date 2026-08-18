# REPL

Executa JavaScript em um contexto vm do Node.js persistente dentro da sessão. `await` de nível superior é suportado, e variáveis/funções definidas em uma chamada permanecem disponíveis em chamadas posteriores.

## Quando usar

- Cálculo rápido, transformação de dados ou manipulação de JSON que é mais fácil em código do que em one-liners de shell.
- Scripts de múltiplas etapas onde o estado intermediário deve persistir entre chamadas (contadores, resultados acumulados).
- Sondar o comportamento de uma API ou biblioteca interativamente antes de escrevê-lo em um arquivo.

## Ativação

- Desativado por padrão — defina `CLAUDE_CODE_REPL=true` para habilitá-lo.
- Em sessões de terminal (`cli`) e claude.ai (`remote`), uma feature flag do lado do servidor também pode habilitá-lo.
- Quando desativado, o REPL fica oculto da lista de ferramentas do modelo. Quando ativado, `Read`, `Glob`, `Grep`, `Bash`, `PowerShell` e `NotebookEdit` são substituídos pelos atalhos do REPL.

## Parâmetros

- `code` (string, obrigatório): Código JavaScript a executar. Suporta await de nível superior. O estado persiste entre chamadas.
- `description` (string, opcional): Descrição clara e concisa do que este script faz em voz ativa (5–10 palavras), por exemplo "Trace upgrade message to its GrowthBook flag".
- `timeout` (number, opcional): Timeout em milissegundos. O padrão é 30000; máximo 600000.

## Exemplos

### Exemplo 1: Calcular e reutilizar estado

```
REPL(code="const counts = new Map(); ['a','b','a'].forEach(k => counts.set(k, (counts.get(k)||0)+1)); counts.get('a')")
```

Retorna `2`; `counts` permanece definido para chamadas REPL subsequentes na mesma sessão.

### Exemplo 2: Await de nível superior com um timeout maior

```
REPL(
  code="const res = await fetch('https://example.com/api'); await res.json()",
  description="Fetch example API and parse JSON",
  timeout=60000
)
```

## Observações

- O estado é por sessão: reiniciar a sessão limpa todas as definições.
- Este é um ambiente JavaScript (Node) — use Bash para comandos shell, trabalho pesado com sistema de arquivos ou runtimes não-JS.
- Código de longa duração deve definir um `timeout` explícito; o padrão de 30s mata qualquer coisa mais lenta.
