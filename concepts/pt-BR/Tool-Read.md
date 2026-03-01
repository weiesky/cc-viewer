# Read

## Definição

Lê conteúdo de arquivo do sistema de arquivos local. Suporta arquivos de texto, imagens, PDF e Jupyter notebook.

## Parâmetros

| Parâmetro | Tipo | Obrigatório | Descrição |
|------|------|------|------|
| `file_path` | string | Sim | Caminho absoluto do arquivo |
| `offset` | number | Não | Número da linha inicial (para leitura segmentada de arquivos grandes) |
| `limit` | number | Não | Número de linhas a ler (para leitura segmentada de arquivos grandes) |
| `pages` | string | Não | Intervalo de páginas do PDF (ex: "1-5", "3", "10-20"), aplicável apenas a PDF |

## Cenários de Uso

**Adequado para:**
- Ler arquivos de código, configuração e outros arquivos de texto
- Visualizar arquivos de imagem (Claude é um modelo multimodal)
- Ler documentos PDF
- Ler Jupyter notebooks (retorna todas as células e saídas)
- Ler múltiplos arquivos em paralelo para obter contexto

**Não adequado para:**
- Ler diretórios — deve usar o comando `ls` do Bash
- Exploração aberta da base de código — deve usar Task (tipo Explore)

## Observações

- O caminho deve ser absoluto, não relativo
- Por padrão, lê as primeiras 2000 linhas do arquivo
- Linhas com mais de 2000 caracteres serão truncadas
- A saída usa formato `cat -n`, com números de linha começando em 1
- PDFs grandes (mais de 10 páginas) devem especificar o parâmetro `pages`, máximo de 20 páginas por vez
- Ler um arquivo inexistente retorna erro (não causa crash)
- Pode chamar múltiplos Read em paralelo em uma única mensagem

## Significado no cc-viewer

As chamadas Read aparecem nos logs de requisição como pares de content blocks `tool_use` (chamada) e `tool_result` (conteúdo retornado). O `tool_result` contém o conteúdo real do arquivo, podendo ser usado para analisar quais arquivos o modelo leu.

## Texto original

<textarea readonly>Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to 2000 lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters
- Any lines longer than 2000 characters will be truncated
- Results are returned using cat -n format, with line numbers starting at 1
- This tool allows Claude Code to read images (eg PNG, JPG, etc). When reading an image file the contents are presented visually as Claude Code is a multimodal LLM.
- This tool can read PDF files (.pdf). For large PDFs (more than 10 pages), you MUST provide the pages parameter to read specific page ranges (e.g., pages: "1-5"). Reading a large PDF without the pages parameter will fail. Maximum 20 pages per request.
- This tool can read Jupyter notebooks (.ipynb files) and returns all cells with their outputs, combining code, text, and visualizations.
- This tool can only read files, not directories. To read a directory, use an ls command via the Bash tool.
- You can call multiple tools in a single response. It is always better to speculatively read multiple potentially useful files in parallel.
- You will regularly be asked to read screenshots. If the user provides a path to a screenshot, ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.</textarea>
