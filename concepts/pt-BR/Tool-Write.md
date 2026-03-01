# Write

## Definição

Escreve conteúdo no sistema de arquivos local. Se o arquivo já existir, será sobrescrito.

## Parâmetros

| Parâmetro | Tipo | Obrigatório | Descrição |
|------|------|------|------|
| `file_path` | string | Sim | Caminho absoluto do arquivo (deve ser caminho absoluto) |
| `content` | string | Sim | Conteúdo a ser escrito |

## Cenários de Uso

**Adequado para:**
- Criar novos arquivos
- Quando é necessário reescrever completamente o conteúdo do arquivo

**Não adequado para:**
- Modificar conteúdo parcial de um arquivo — deve usar Edit
- Não deve criar proativamente arquivos de documentação (*.md) ou README, a menos que o usuário solicite explicitamente

## Observações

- Se o arquivo de destino já existir, é obrigatório lê-lo primeiro via Read, caso contrário falhará
- Sobrescreve todo o conteúdo do arquivo existente
- Prefira usar Edit para editar arquivos existentes; Write é apenas para criar novos arquivos ou reescrita completa

## Significado no cc-viewer

A chamada Write aparece nos logs de requisição como um content block `tool_use`, cujo `input.content` contém o conteúdo completo escrito.

## Texto original

<textarea readonly>Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.</textarea>
