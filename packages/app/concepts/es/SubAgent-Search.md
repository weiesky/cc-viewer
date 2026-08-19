# SubAgent: Search

## Propósito

El subagente Search es un agente de exploración ligero y de solo lectura. Despáchalo cuando necesites entender un código — encontrar dónde vive algo, aprender cómo encajan los componentes o responder preguntas estructurales — sin modificar ningún archivo. Está optimizado para muchas lecturas pequeñas a lo largo de muchos archivos, devolviendo un resumen conciso en lugar de la salida bruta de búsqueda.

Search no es un asistente de propósito general. No puede editar código, ejecutar builds, hacer commits ni abrir conexiones de red más allá de fetches de solo lectura. Su valor es que puede consumir un gran presupuesto de exploración en paralelo sin consumir el contexto del agente principal, y luego devolver una respuesta compacta.

## Cuándo usar

- Necesitas responder una pregunta que requiere tres o más búsquedas o lecturas distintas. Ejemplo: "¿Cómo se conecta la autenticación desde la ruta de login hasta el almacén de sesiones?"
- El objetivo es desconocido — aún no sabes qué archivo, módulo o símbolo mirar.
- Necesitas una visión estructural general de un área desconocida del repo antes de hacer cambios.
- Quieres cruzar referencias de múltiples candidatos (por ejemplo, cuál de varios helpers con nombres similares se llama realmente en producción).
- Necesitas un resumen al estilo de una revisión bibliográfica: "lista cada lugar que importa X y categorízalo por sitio de llamada."

No uses Search cuando:

- Ya conoces el archivo y la línea exactos. Llama a `Read` directamente.
- Un solo `Grep` o `Glob` responderá la pregunta. Ejecútalo directamente; despachar un subagente añade sobrecarga.
- La tarea requiere editar, ejecutar comandos o cualquier efecto secundario. Search es de solo lectura por diseño.
- Necesitas la salida verbatim exacta de una llamada de herramienta. Los subagentes resumen; no hacen proxy de resultados brutos.

## Niveles de exhaustividad

Elige el nivel que coincida con lo que está en juego.

- `quick` — unas pocas búsquedas dirigidas, respuesta de mejor esfuerzo. Úsalo cuando necesites un puntero rápido (por ejemplo, "¿dónde está la lógica de parseo de variables de entorno?") y estés cómodo iterando si la respuesta es incompleta.
- `medium` — el valor por defecto. Varias rondas de búsqueda, comprobación cruzada de candidatos y lectura completa de los archivos más relevantes. Úsalo para preguntas típicas de "ayúdame a entender esta área".
- `very thorough` — exploración exhaustiva. El subagente perseguirá cada pista plausible, leerá el contexto circundante y verificará dos veces los hallazgos antes de resumir. Úsalo cuando la corrección importe (por ejemplo, revisión de seguridad, planificación de migración) o cuando una respuesta incompleta causaría retrabajo.

Niveles de exhaustividad más altos cuestan más tiempo y tokens dentro del subagente, pero esos tokens se quedan dentro del subagente — solo el resumen final vuelve al agente principal.

## Herramientas disponibles

Search tiene acceso a todas las herramientas de solo lectura que usa el agente principal, y nada más:

- `Read` — para leer archivos específicos, incluyendo rangos parciales.
- `Grep` — para búsquedas de contenido en el árbol.
- `Glob` — para localizar archivos por patrón de nombre.
- `Bash` en modo de solo lectura — para comandos que inspeccionan estado sin mutarlo (por ejemplo `git log`, `git show`, `ls`, `wc`).
- `WebFetch` y `WebSearch` — para leer documentación externa cuando ese contexto es requerido.

Las herramientas de edición (`Write`, `Edit`, `NotebookEdit`), los comandos de shell que modifican el estado y las herramientas del grafo de tareas (`TaskCreate`, `TaskUpdate`, etc.) no están disponibles deliberadamente.

## Notas

- Dale al subagente Search una pregunta específica, no un tema. "Lista cada llamador de `renderMessage` y anota cuáles pasan un tema personalizado" devuelve una respuesta útil; "cuéntame sobre el renderizado" no.
- El subagente devuelve un resumen. Si necesitas rutas de archivo exactas, pídelas explícitamente en tu prompt.
- Varias preguntas independientes se despachan mejor como subagentes Search paralelos en lugar de un prompt largo, para que cada uno pueda enfocarse.
- Como Search no puede editar, combínalo con un paso de edición de seguimiento en el agente principal una vez que sepas qué cambiar.
- Trata la salida de Search como evidencia, no como verdad absoluta. Para cualquier cosa crítica, abre los archivos citados tú mismo antes de actuar.
