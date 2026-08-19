# LSP

Consulta servidores do Language Server Protocol (LSP) para inteligência de código — definições, referências, hovers, símbolos, implementações e hierarquia de chamadas. Mais preciso do que a busca textual porque entende o código semanticamente.

## Quando usar

- Saltar para a definição de um símbolo (`goToDefinition`) ou encontrar todas as referências (`findReferences`)
- Ler assinaturas de tipo / documentação de um símbolo (`hover`)
- Listar símbolos em um arquivo (`documentSymbol`) ou buscá-los em todo o projeto (`workspaceSymbol`)
- Encontrar implementações de uma interface ou método abstrato (`goToImplementation`)
- Percorrer a hierarquia de chamadas de uma função (`prepareCallHierarchy`, `incomingCalls`, `outgoingCalls`)

## Ativação

- Inativo até que um plugin de code intelligence para a linguagem seja instalado (o binário do servidor é instalado separadamente).
- A ferramenta só aparece quando um cliente LSP está conectado.

## Parâmetros

- `operation` (string, obrigatório): uma das operações listadas acima.
- `filePath` (string, obrigatório): o arquivo sobre o qual operar.
- `line` (number, obrigatório): número de linha baseado em 1, como mostrado no editor.
- `character` (number, obrigatório): deslocamento de caractere baseado em 1, como mostrado no editor.

## Observações

- Requer um servidor LSP configurado para aquele tipo de arquivo; caso contrário, a chamada retorna um erro.
- Linha e caractere são baseados em 1 (coordenadas do editor), não em 0.
- Prefira LSP em vez de `Grep` quando você precisar de navegação semântica (definição/referência verdadeira) em vez de uma correspondência textual.

## Conceitos relacionados

- Complementa `Read` e `Edit` ao navegar e alterar código.
