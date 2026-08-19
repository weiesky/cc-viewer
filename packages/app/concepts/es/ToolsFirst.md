# ¿Por qué se listan primero los Tools?

En el panel Context de cc-viewer, **los Tools aparecen antes que el System Prompt y los Messages**. Este orden refleja con precisión la **secuencia de prefijo KV-Cache de la API de Anthropic**.

## Secuencia de prefijo KV-Cache

Cuando la API de Anthropic construye el KV-Cache, concatena el contexto en un prefijo en este **orden fijo**:

```
┌─────────────────────────────────────────────────┐
│ 1. Tools (JSON Schema definitions)               │  ← Start of cache prefix
│ 2. System Prompt                                 │
│ 3. Messages (conversation history + current turn)│  ← End of cache prefix
└─────────────────────────────────────────────────┘
```

Esto significa que **los Tools se encuentran antes del System Prompt, al comienzo del prefijo de caché**.

## ¿Por qué los Tools tienen mayor peso en caché que System?

En la coincidencia de prefijo KV-Cache, **el contenido más temprano es más crítico** — cualquier cambio invalida todo lo que viene después:

1. **La coincidencia de prefijo comienza desde el principio**: El KV-Cache compara la solicitud actual con el prefijo almacenado en caché token por token desde el inicio. En el momento en que se detecta una discrepancia, todo el contenido posterior queda invalidado.

2. **Cambio en Tools = todo el caché invalidado**: Como los Tools están primero, cualquier cambio en las definiciones de tool (incluso agregar o eliminar un solo MCP tool) **rompe el prefijo desde el mismísimo inicio**, invalidando todo el System Prompt y los Messages almacenados en caché.

3. **Cambio en System = caché de Messages invalidado**: El System Prompt está en el medio, por lo que sus cambios solo invalidan la porción de Messages que le sigue.

4. **Cambio en Messages = solo el final se ve afectado**: Los Messages están al final, por lo que agregar nuevos messages solo invalida un pequeño segmento final — los cachés de Tools y System permanecen intactos.

## Impacto práctico

| Tipo de cambio | Impacto en caché | Escenario típico |
|-------------|-------------|-----------------|
| Tool agregado/eliminado | **Invalidación completa** | Conexión/desconexión de servidor MCP, activación/desactivación de plugin IDE |
| Cambio en System Prompt | Caché de Messages perdido | Edición de CLAUDE.md, inyección de system reminder |
| Nuevo message agregado | Solo incremento de cola | Flujo de conversación normal (el más común, el más económico) |

Por eso `tools_change` en [CacheRebuild](CacheRebuild.md) tiende a ser la razón de reconstrucción más costosa — rompe la cadena de prefijo desde el principio.

## ¿Por qué las definiciones de herramientas se colocan antes del "cerebro"?

Desde la perspectiva del caché, que los Tools estén primero es un hecho técnico. Pero desde la perspectiva del diseño cognitivo, este orden es igualmente lógico — **los Tools son las manos y los pies, el System Prompt es el cerebro**.

Antes de actuar, una persona necesita percibir qué extremidades y herramientas tiene disponibles. Un bebé no comprende primero las reglas del mundo (System) para luego aprender a agarrar — primero percibe que tiene manos y pies, y luego comprende gradualmente las reglas a través de la interacción con el entorno. Del mismo modo, un LLM necesita saber qué herramientas puede llamar (leer archivos, escribir código, buscar, ejecutar comandos) antes de recibir las instrucciones de tarea (System Prompt), para poder evaluar con precisión "qué puedo hacer" y "cómo debo hacerlo" al procesar las instrucciones.

Si fuera al revés — decirle primero al modelo "tu tarea es refactorizar este módulo", y luego "tienes las herramientas Read, Edit, Bash" — el modelo carecería de información crucial sobre los límites de sus capacidades al entender la tarea, produciendo potencialmente planes poco realistas u omitiendo enfoques disponibles.

**Conocer las cartas que tienes antes de decidir cómo jugar.** Esta es la lógica cognitiva detrás de que los Tools precedan al System.

## ¿Por qué las herramientas MCP también están en esta posición?

Las herramientas MCP (Model Context Protocol), al igual que las herramientas integradas, se colocan al inicio de la zona Tools. Comprender la posición de MCP en el contexto ayuda a evaluar sus beneficios y costes reales.

### Ventajas de MCP

- **Extensión de capacidades**: MCP permite a los modelos acceder a servicios externos (consultas a bases de datos, llamadas API, operaciones IDE, control del navegador, etc.), superando los límites de las herramientas integradas
- **Ecosistema abierto**: Cualquiera puede implementar un servidor MCP; el modelo obtiene nuevas capacidades sin reentrenamiento
- **Carga bajo demanda**: Los servidores MCP pueden conectarse/desconectarse selectivamente según el escenario, componiendo conjuntos de herramientas flexibles

### Costes de MCP

- **Asesino de caché**: La definición JSON Schema de cada herramienta MCP se concatena al inicio del prefijo KV-Cache. Añadir o eliminar una herramienta MCP = **todo el caché se invalida desde el principio**. Conectar/desconectar frecuentemente servidores MCP reduce drásticamente la tasa de aciertos del caché
- **Inflación del prefijo**: Los Schemas de herramientas MCP suelen ser más grandes que los de herramientas integradas (descripciones detalladas de parámetros, valores de enumeración, etc.). Muchas herramientas MCP aumentan significativamente el conteo de tokens de la zona Tools, reduciendo el espacio de contexto disponible para Messages
- **Sobrecarga de latencia**: Las llamadas a herramientas MCP requieren comunicación entre procesos (JSON-RPC sobre stdio/SSE), un orden de magnitud más lento que las llamadas a funciones integradas
- **Riesgo de estabilidad**: Los servidores MCP son procesos externos que pueden fallar, expirar o devolver formatos inesperados, requiriendo manejo de errores adicional

### Recomendaciones prácticas

| Escenario | Recomendación |
|-----------|--------------|
| Conversaciones largas, interacción frecuente | Minimizar la cantidad de herramientas MCP para proteger la estabilidad del prefijo de caché |
| Tareas cortas, operaciones puntuales | Usar herramientas MCP libremente; el impacto en el caché es limitado |
| Adición/eliminación frecuente de servidores MCP | Cada cambio desencadena una reconstrucción completa del caché; considerar fijar el conjunto de herramientas |
| Schemas de herramientas sobredimensionados | Reducir descripciones y enums para disminuir el consumo de tokens del prefijo |

En el panel Context de cc-viewer, las herramientas MCP se muestran junto a las herramientas integradas en la zona Tools, ofreciendo una vista clara del tamaño del Schema de cada herramienta y su contribución al prefijo de caché.
