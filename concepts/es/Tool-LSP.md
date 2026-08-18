# LSP

Consulta servidores Language Server Protocol (LSP) para obtener inteligencia de código: definiciones, referencias, información al pasar el cursor, símbolos, implementaciones y jerarquía de llamadas. Más preciso que la búsqueda de texto porque entiende el código de forma semántica.

## Cuándo usarlo

- Saltar a la definición de un símbolo (`goToDefinition`) o encontrar cada una de sus referencias (`findReferences`)
- Leer las firmas de tipos / la documentación de un símbolo (`hover`)
- Listar los símbolos de un archivo (`documentSymbol`) o buscarlos en todo el proyecto (`workspaceSymbol`)
- Encontrar las implementaciones de una interfaz o un método abstracto (`goToImplementation`)
- Recorrer la jerarquía de llamadas de una función (`prepareCallHierarchy`, `incomingCalls`, `outgoingCalls`)

## Activación

- Inactivo hasta que se instale un plugin de inteligencia de código para el lenguaje (el binario del servidor se instala por separado).
- La herramienta solo aparece cuando hay un cliente LSP conectado.

## Parámetros

- `operation` (string, obligatorio): una de las operaciones enumeradas arriba.
- `filePath` (string, obligatorio): el archivo sobre el que operar.
- `line` (number, obligatorio): número de línea basado en 1, tal como se muestra en el editor.
- `character` (number, obligatorio): desplazamiento de carácter basado en 1, tal como se muestra en el editor.

## Notas

- Requiere un servidor LSP configurado para ese tipo de archivo; de lo contrario, la llamada devuelve un error.
- La línea y el carácter están basados en 1 (coordenadas del editor), no en 0.
- Prefiere LSP frente a `Grep` cuando necesites navegación semántica (definición/referencia real) en lugar de una coincidencia textual.

## Conceptos relacionados

- Complementa a `Read` y `Edit` al navegar y modificar código.
