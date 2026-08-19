# Glob

Faz correspondência de nomes de arquivo contra um padrão glob e retorna os caminhos ordenados pelo horário de modificação mais recente primeiro. Otimizado para localizar arquivos rapidamente em codebases de qualquer tamanho sem recorrer ao `find`.

## Quando usar

- Enumerar todo arquivo de uma extensão específica (por exemplo, todos os arquivos `*.ts` sob `src`)
- Descobrir arquivos de configuração ou fixtures por convenção de nomenclatura (`**/jest.config.*`, `**/*.test.tsx`)
- Reduzir a superfície de busca antes de rodar um `Grep` mais focado
- Verificar se um arquivo já existe em um padrão conhecido antes de chamar `Write`
- Encontrar arquivos modificados recentemente confiando na ordenação por horário de modificação

## Parâmetros

- `pattern` (string, obrigatório): A expressão glob a corresponder. Suporta `*` para wildcards de segmento único, `**` para correspondências recursivas e `{a,b}` para alternativas, por exemplo `src/**/*.{ts,tsx}`.
- `path` (string, opcional): Diretório em que rodar a busca. Deve ser um caminho de diretório válido quando fornecido. Omita o campo completamente para buscar no diretório de trabalho atual. Não passe as strings `"undefined"` ou `"null"`.

## Exemplos

### Exemplo 1: Todo arquivo fonte TypeScript
Chame `Glob` com `pattern: "src/**/*.ts"`. O resultado é uma lista ordenada por mtime, então os arquivos editados mais recentemente aparecem primeiro, o que é útil para focar em pontos quentes.

### Exemplo 2: Localizar um candidato a definição de classe
Quando você suspeita que uma classe vive em um arquivo cujo nome você não sabe, busque com `pattern: "**/*UserService*"` para restringir os candidatos, depois siga com `Read` ou `Grep`.

### Exemplo 3: Descoberta paralela antes de uma tarefa maior
Em uma única mensagem, dispare múltiplas chamadas `Glob` (por exemplo, uma para `**/*.test.ts` e uma para `**/fixtures/**`) para que ambas rodem em paralelo e seus resultados possam ser correlacionados.

## Observações

- Os resultados são ordenados por horário de modificação do arquivo (mais novo primeiro), não alfabeticamente. Ordene a jusante se precisar de ordenação estável.
- Os padrões são avaliados pela ferramenta, não pelo shell; você não precisa colocá-los entre aspas ou escapá-los como faria na linha de comando.
- Para exploração aberta que exige várias rodadas de busca e raciocínio, delegue para um `Agent` com o tipo de agente Explore em vez de encadear muitas chamadas `Glob`.
- Prefira `Glob` em vez de invocações `Bash` de `find` ou `ls` para descoberta de nomes de arquivo; ele lida com permissões de forma consistente e retorna saída estruturada.
- Quando procurar conteúdo dentro de arquivos em vez de nomes de arquivo, use `Grep`.
