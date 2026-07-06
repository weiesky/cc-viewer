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

## Texto original

<textarea readonly>Get language diagnostics from VS Code</textarea>
