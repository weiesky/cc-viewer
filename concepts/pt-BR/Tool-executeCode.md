# executeCode (mcp__ide__executeCode)

## Definição

Executa código Python no kernel Jupyter do arquivo notebook atual.

## Parâmetros

| Parâmetro | Tipo | Obrigatório | Descrição |
|------|------|------|------|
| `code` | string | Sim | Código Python a ser executado |

## Cenários de Uso

**Adequado para:**
- Executar código em ambiente Jupyter notebook
- Testar trechos de código
- Análise de dados e cálculos

**Não adequado para:**
- Execução de código fora do ambiente Jupyter — deve usar Bash
- Modificar arquivos — deve usar Edit ou Write

## Observações

- Esta é uma ferramenta MCP (Model Context Protocol), fornecida pela integração com IDE
- O código é executado no kernel Jupyter atual, o estado persiste entre chamadas
- A menos que o usuário solicite explicitamente, deve-se evitar declarar variáveis ou modificar o estado do kernel
- O estado é perdido após reiniciar o kernel

## Significado no cc-viewer

executeCode é uma ferramenta MCP, aparece no array `tools` dos logs de requisição com o nome `mcp__ide__executeCode`. Suas chamadas e retornos seguem o padrão `tool_use` / `tool_result`. A adição/remoção de ferramentas MCP causa alterações no array tools, podendo acionar reconstrução de cache.

## Texto original

<textarea readonly>Execute python code in the Jupyter kernel for the current notebook file.
    
    All code will be executed in the current Jupyter kernel.
    
    Avoid declaring variables or modifying the state of the kernel unless the user
    explicitly asks for it.
    
    Any code executed will persist across calls to this tool, unless the kernel
    has been restarted.</textarea>
