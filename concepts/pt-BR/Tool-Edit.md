# Edit

## Definição

Edita arquivos através de substituição exata de strings. Substitui `old_string` por `new_string` no arquivo.

## Parâmetros

| Parâmetro | Tipo | Obrigatório | Descrição |
|------|------|------|------|
| `file_path` | string | Sim | Caminho absoluto do arquivo a ser modificado |
| `old_string` | string | Sim | Texto original a ser substituído |
| `new_string` | string | Sim | Novo texto após a substituição (deve ser diferente de old_string) |
| `replace_all` | boolean | Não | Se deve substituir todas as ocorrências, padrão `false` |

## Cenários de Uso

**Adequado para:**
- Modificar trechos específicos de código em arquivos existentes
- Corrigir bugs, atualizar lógica
- Renomear variáveis (com `replace_all: true`)
- Qualquer cenário que requer modificação precisa do conteúdo de um arquivo

**Não adequado para:**
- Criar novos arquivos — deve usar Write
- Reescrita em grande escala — pode ser necessário usar Write para sobrescrever o arquivo inteiro

## Observações

- Antes de usar, é obrigatório ter lido o arquivo via Read, caso contrário ocorrerá erro
- `old_string` deve ser único no arquivo, caso contrário a edição falhará. Se não for único, forneça mais contexto para torná-lo único, ou use `replace_all`
- Ao editar texto, deve-se manter a indentação original (tab/espaços), não incluir o prefixo de número de linha da saída do Read
- Prefira editar arquivos existentes em vez de criar novos
- `new_string` deve ser diferente de `old_string`

## Significado no cc-viewer

A chamada Edit aparece nos logs de requisição como um content block `tool_use`, cujo `input` contém `old_string` e `new_string`, podendo ser usado para rastrear quais modificações o modelo fez nos arquivos.

## Texto original

<textarea readonly>Performs exact string replacements in files.

Usage:
- You must use your `Read` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file. 
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if `old_string` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use `replace_all` to change every instance of `old_string`.
- Use `replace_all` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.</textarea>
