# getDiagnostics (mcp__ide__getDiagnostics)

## Definição

Obtém informações de diagnóstico de linguagem do VS Code, incluindo erros de sintaxe, erros de tipo, avisos de lint, etc.

## Parâmetros

| Parâmetro | Tipo | Obrigatório | Descrição |
|------|------|------|------|
| `uri` | string | Não | URI do arquivo. Se não fornecido, obtém diagnósticos de todos os arquivos |

## Cenários de Uso

**Adequado para:**
- Verificar problemas semânticos como sintaxe, tipos e lint no código
- Verificar se novas edições introduziram erros
- Substituir comandos Bash para verificar qualidade do código

**Não adequado para:**
- Executar testes — deve usar Bash
- Verificar erros de runtime — deve usar Bash para executar o código

## Observações

- Esta é uma ferramenta MCP (Model Context Protocol), fornecida pela integração com IDE
- Disponível apenas em ambiente VS Code / IDE
- Prefira usar esta ferramenta em vez de comandos Bash para verificar problemas no código

## Significado no cc-viewer

getDiagnostics é uma ferramenta MCP, aparece no array `tools` dos logs de requisição com o nome `mcp__ide__getDiagnostics`. Suas chamadas e retornos seguem o padrão `tool_use` / `tool_result`. A adição/remoção de ferramentas MCP causa alterações no array tools, podendo acionar reconstrução de cache.

## Texto original

<textarea readonly>Get language diagnostics from VS Code</textarea>
