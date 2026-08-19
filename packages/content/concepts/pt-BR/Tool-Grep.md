# Grep

Busca conteúdo de arquivos usando o motor ripgrep. Oferece suporte completo a expressões regulares, filtragem por tipo de arquivo e três modos de saída para que você possa equilibrar precisão com concisão.

## Quando usar

- Localizar todos os pontos de chamada de uma função ou toda referência a um identificador
- Verificar se uma string ou mensagem de erro aparece em algum lugar no codebase
- Contar ocorrências de um padrão para avaliar o impacto antes de refatorar
- Restringir uma busca a um tipo de arquivo (`type: "ts"`) ou glob (`glob: "**/*.tsx"`)
- Extrair correspondências entre linhas, como definições de struct multilinha ou blocos JSX com `multiline: true`

## Parâmetros

- `pattern` (string, obrigatório): A expressão regular a buscar. Usa sintaxe do ripgrep, portanto chaves literais precisam de escape (por exemplo `interface\{\}` para encontrar `interface{}`).
- `path` (string, opcional): Arquivo ou diretório a buscar. O padrão é o diretório de trabalho atual.
- `glob` (string, opcional): Filtro de nome de arquivo como `*.js` ou `*.{ts,tsx}`.
- `type` (string, opcional): Atalho por tipo de arquivo como `js`, `py`, `rust`, `go`. Mais eficiente que `glob` para linguagens padrão.
- `output_mode` (enum, opcional): `files_with_matches` (padrão, retorna apenas caminhos), `content` (retorna linhas que correspondem) ou `count` (retorna contagens de correspondências).
- `-i` (boolean, opcional): Correspondência sem diferenciação de maiúsculas e minúsculas.
- `-n` (boolean, opcional): Inclui números de linha no modo `content`. O padrão é `true`.
- `-A` (number, opcional): Linhas de contexto a mostrar após cada correspondência (requer modo `content`).
- `-B` (number, opcional): Linhas de contexto antes de cada correspondência (requer modo `content`).
- `-C` / `context` (number, opcional): Linhas de contexto em ambos os lados de cada correspondência.
- `multiline` (boolean, opcional): Permite que padrões atravessem newlines (`.` corresponde a `\n`). O padrão é `false`.
- `head_limit` (number, opcional): Limita linhas, caminhos de arquivo ou entradas de contagem retornadas. O padrão é 250; passe `0` para ilimitado (use com moderação).
- `offset` (number, opcional): Pula os primeiros N resultados antes de aplicar `head_limit`. O padrão é `0`.

## Exemplos

### Exemplo 1: Encontrar todos os pontos de chamada de uma função
Defina `pattern: "registerHandler\\("`, `output_mode: "content"` e `-C: 2` para ver as linhas ao redor de cada chamada.

### Exemplo 2: Contar correspondências em um tipo
Defina `pattern: "TODO"`, `type: "py"` e `output_mode: "count"` para ver totais de TODO por arquivo em fontes Python.

### Exemplo 3: Correspondência multilinha em struct
Use `pattern: "struct Config \\{[\\s\\S]*?version"` com `multiline: true` para capturar um campo declarado várias linhas dentro de uma struct Go.

## Observações

- Sempre prefira `Grep` a rodar `grep` ou `rg` via `Bash`; a ferramenta é otimizada para permissões corretas e saída estruturada.
- O modo de saída padrão é `files_with_matches`, que é o mais barato. Mude para `content` apenas quando precisar ver as próprias linhas.
- Flags de contexto (`-A`, `-B`, `-C`) são ignoradas a menos que `output_mode` seja `content`.
- Conjuntos grandes de resultados queimam tokens de contexto. Use `head_limit`, `offset` ou filtros `glob`/`type` mais apertados para manter o foco.
- Para descoberta de nomes de arquivo, use `Glob`; para investigações abertas em várias rodadas, dispare um `Agent` com o agente Explore.
