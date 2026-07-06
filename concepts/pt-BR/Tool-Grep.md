# Grep

## Definição

Ferramenta poderosa de busca de conteúdo baseada em ripgrep. Suporta expressões regulares, filtragem por tipo de arquivo e múltiplos modos de saída.

## Parâmetros

| Parâmetro | Tipo | Obrigatório | Descrição |
|------|------|------|------|
| `pattern` | string | Sim | Padrão de busca com expressão regular |
| `path` | string | Não | Caminho de busca (arquivo ou diretório), padrão é o diretório de trabalho atual |
| `glob` | string | Não | Filtro de nome de arquivo (ex: `*.js`, `*.{ts,tsx}`) |
| `type` | string | Não | Filtro de tipo de arquivo (ex: `js`, `py`, `rust`), mais eficiente que glob |
| `output_mode` | enum | Não | Modo de saída: `files_with_matches` (padrão), `content`, `count` |
| `-i` | boolean | Não | Busca sem distinção de maiúsculas/minúsculas |
| `-n` | boolean | Não | Exibir números de linha (apenas modo content), padrão true |
| `-A` | number | Não | Número de linhas a exibir após a correspondência |
| `-B` | number | Não | Número de linhas a exibir antes da correspondência |
| `-C` / `context` | number | Não | Número de linhas a exibir antes e depois da correspondência |
| `head_limit` | number | Não | Limitar número de entradas na saída, padrão 0 (ilimitado) |
| `offset` | number | Não | Pular os primeiros N resultados |
| `multiline` | boolean | Não | Ativar modo de correspondência multilinha, padrão false |

## Cenários de Uso

**Adequado para:**
- Buscar strings ou padrões específicos na base de código
- Encontrar locais de uso de funções/variáveis
- Filtrar resultados de busca por tipo de arquivo
- Contar número de correspondências

**Não adequado para:**
- Buscar arquivos por nome — deve usar Glob
- Exploração aberta que requer múltiplas rodadas de busca — deve usar Task (tipo Explore)

## Observações

- Usa sintaxe ripgrep (não grep), caracteres especiais como chaves precisam ser escapados
- O modo `files_with_matches` retorna apenas caminhos de arquivo, é o mais eficiente
- O modo `content` retorna o conteúdo das linhas correspondentes, suporta linhas de contexto
- Correspondência multilinha requer `multiline: true`
- Sempre prefira usar a ferramenta Grep em vez dos comandos `grep` ou `rg` no Bash

## Texto original

<textarea readonly>A powerful search tool built on ripgrep

  Usage:
  - ALWAYS use Grep for search tasks. NEVER invoke `grep` or `rg` as a Bash command. The Grep tool has been optimized for correct permissions and access.
  - Supports full regex syntax (e.g., "log.*Error", "function\s+\w+")
  - Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")
  - Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts
  - Use Agent tool for open-ended searches requiring multiple rounds
  - Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping (use `interface\{\}` to find `interface{}` in Go code)
  - Multiline matching: By default patterns match within single lines only. For cross-line patterns like `struct \{[\s\S]*?field`, use `multiline: true`
</textarea>
