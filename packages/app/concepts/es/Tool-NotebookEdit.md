# NotebookEdit

Modifica una sola celda en un notebook de Jupyter (`.ipynb`). Permite reemplazar el código fuente de una celda, insertar una nueva celda o eliminar una celda existente preservando el resto de la estructura del notebook.

## Cuándo usar

- Corregir o actualizar una celda de código en un notebook de análisis sin reescribir todo el archivo
- Sustituir una celda markdown para mejorar la narrativa o añadir documentación
- Insertar una nueva celda de código o markdown en una posición conocida dentro de un notebook existente
- Eliminar una celda obsoleta o defectuosa para que las celdas posteriores ya no dependan de ella
- Preparar un notebook reproducible iterando sobre las celdas una a la vez

## Parámetros

- `notebook_path` (string, obligatorio): Ruta absoluta al archivo `.ipynb`. Las rutas relativas son rechazadas.
- `new_source` (string, obligatorio): El nuevo código fuente de la celda. Para `replace` e `insert` se convierte en el cuerpo de la celda; para `delete` se ignora pero sigue siendo requerido por el esquema.
- `cell_id` (string, opcional): ID de la celda objetivo. En los modos `replace` y `delete`, la herramienta actúa sobre esta celda. En modo `insert`, la nueva celda se inserta inmediatamente después de la celda con este ID; omítelo para insertar al principio del notebook.
- `cell_type` (enum, opcional): Ya sea `code` o `markdown`. Obligatorio cuando `edit_mode` es `insert`. Cuando se omite durante `replace`, se preserva el tipo existente de la celda.
- `edit_mode` (enum, opcional): `replace` (por defecto), `insert` o `delete`.

## Ejemplos

### Ejemplo 1: Reemplazar una celda de código con bug
Llama a `NotebookEdit` con `notebook_path` establecido a la ruta absoluta, `cell_id` al ID de la celda objetivo y `new_source` conteniendo el código Python corregido. Deja `edit_mode` en su valor por defecto `replace`.

### Ejemplo 2: Insertar una explicación markdown
Para añadir una celda markdown justo después de una celda existente `setup`, establece `edit_mode: "insert"`, `cell_type: "markdown"`, `cell_id` al ID de la celda setup y pon la narrativa en `new_source`.

### Ejemplo 3: Eliminar una celda obsoleta
Establece `edit_mode: "delete"` y proporciona el `cell_id` de la celda a eliminar. Proporciona cualquier cadena para `new_source`; no se aplica.

## Notas

- Siempre pasa una ruta absoluta. `NotebookEdit` no resuelve rutas relativas contra el directorio de trabajo.
- La herramienta reescribe solo la celda objetivo; los conteos de ejecución, salidas y metadatos de las celdas no relacionadas permanecen intactos.
- Insertar sin un `cell_id` coloca la nueva celda al principio mismo del notebook.
- `cell_type` es obligatorio para inserciones. Para reemplazos, omítelo salvo que explícitamente quieras convertir una celda de código a markdown o viceversa.
- Para inspeccionar celdas y obtener sus IDs, usa primero la herramienta `Read` sobre el notebook; devuelve las celdas con su contenido y salidas.
- Usa `Edit` normal para archivos de código fuente plano; `NotebookEdit` es específico para el JSON `.ipynb` y entiende su estructura de celdas.
