# Edit

Executa uma substituição exata de string dentro de um arquivo existente. É a forma preferida de modificar arquivos porque apenas o diff é transmitido, mantendo as edições precisas e auditáveis.

## Quando usar

- Corrigir um bug em uma única função sem reescrever o arquivo ao redor
- Atualizar um valor de configuração, string de versão ou caminho de import
- Renomear um símbolo ao longo de um arquivo com `replace_all`
- Inserir um bloco próximo a um ponto de âncora (expanda `old_string` para incluir o contexto ao redor, depois forneça o texto de substituição)
- Aplicar edições pequenas e bem delimitadas como parte de uma refatoração em múltiplos passos

## Parâmetros

- `file_path` (string, obrigatório): Caminho absoluto do arquivo a modificar.
- `old_string` (string, obrigatório): O texto exato a procurar. Deve corresponder caractere por caractere, incluindo espaços em branco e indentação.
- `new_string` (string, obrigatório): O texto de substituição. Deve ser diferente de `old_string`.
- `replace_all` (boolean, opcional): Quando `true`, substitui toda ocorrência de `old_string`. O padrão é `false`, que exige que a correspondência seja única.

## Exemplos

### Exemplo 1: Corrigir um único ponto de chamada
Defina `old_string` como a linha exata `const port = 3000;` e `new_string` como `const port = process.env.PORT ?? 3000;`. A correspondência é única, então `replace_all` pode permanecer no padrão.

### Exemplo 2: Renomear um símbolo ao longo de um arquivo
Para renomear `getUser` para `fetchUser` em todos os lugares em `api.ts`, defina `old_string: "getUser"`, `new_string: "fetchUser"` e `replace_all: true`.

### Exemplo 3: Desambiguar um trecho repetido
Se `return null;` aparecer em vários ramos, amplie `old_string` para incluir contexto circundante (por exemplo a linha `if` anterior) para que a correspondência seja única. Caso contrário, a ferramenta retorna erro em vez de adivinhar.

## Observações

- Você deve chamar `Read` no arquivo pelo menos uma vez na sessão atual antes que `Edit` aceite mudanças. Prefixos de número de linha da saída do `Read` não fazem parte do conteúdo do arquivo; não os inclua em `old_string` ou `new_string`.
- O espaço em branco deve corresponder exatamente. Preste atenção em tabulações versus espaços e espaços finais, especialmente em YAML, Makefiles e Python.
- Se `old_string` não for único e `replace_all` for `false`, a edição falha. Expanda o contexto ou habilite `replace_all`.
- Prefira `Edit` em vez de `Write` sempre que o arquivo já existe; `Write` sobrescreve o arquivo inteiro e perde conteúdo não relacionado se você não tiver cuidado.
- Para múltiplas edições não relacionadas no mesmo arquivo, faça várias chamadas `Edit` em sequência em vez de uma grande substituição frágil.
- Evite introduzir emoji, texto de marketing ou blocos de documentação não solicitados ao editar arquivos de código.
