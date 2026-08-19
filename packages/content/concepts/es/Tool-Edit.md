# Edit

Realiza una sustitución exacta de cadenas dentro de un archivo existente. Es la forma preferida de modificar archivos porque solo se transmite el diff, manteniendo las ediciones precisas y auditables.

## Cuándo usar

- Corregir un bug en una sola función sin reescribir el archivo circundante
- Actualizar un valor de configuración, una cadena de versión o una ruta de importación
- Renombrar un símbolo en todo un archivo con `replace_all`
- Insertar un bloque cerca de un ancla (amplía `old_string` para incluir contexto cercano, luego proporciona el reemplazo)
- Aplicar ediciones pequeñas y bien acotadas como parte de un refactor en varios pasos

## Parámetros

- `file_path` (string, obligatorio): Ruta absoluta del archivo a modificar.
- `old_string` (string, obligatorio): El texto exacto a buscar. Debe coincidir carácter por carácter, incluyendo espacios en blanco e indentación.
- `new_string` (string, obligatorio): El texto de reemplazo. Debe diferir de `old_string`.
- `replace_all` (boolean, opcional): Cuando es `true`, reemplaza cada aparición de `old_string`. Por defecto es `false`, lo que requiere que la coincidencia sea única.

## Ejemplos

### Ejemplo 1: Corregir un solo sitio de llamada
Establece `old_string` a la línea exacta `const port = 3000;` y `new_string` a `const port = process.env.PORT ?? 3000;`. La coincidencia es única, por lo que `replace_all` puede quedarse con su valor por defecto.

### Ejemplo 2: Renombrar un símbolo en todo un archivo
Para renombrar `getUser` a `fetchUser` en todas partes de `api.ts`, establece `old_string: "getUser"`, `new_string: "fetchUser"` y `replace_all: true`.

### Ejemplo 3: Desambiguar un fragmento repetido
Si `return null;` aparece en varias ramas, amplía `old_string` para incluir contexto circundante (por ejemplo la línea `if` precedente) de modo que la coincidencia sea única. De lo contrario, la herramienta da error en vez de adivinar.

## Notas

- Debes llamar a `Read` sobre el archivo al menos una vez en la sesión actual antes de que `Edit` acepte cambios. Los prefijos de número de línea de la salida de `Read` no forman parte del contenido del archivo; no los incluyas en `old_string` ni en `new_string`.
- Los espacios en blanco deben coincidir exactamente. Presta atención a tabs versus espacios y a los espacios al final de línea, especialmente en YAML, Makefiles y Python.
- Si `old_string` no es único y `replace_all` es `false`, la edición falla. Amplía el contexto o habilita `replace_all`.
- Prefiere `Edit` sobre `Write` siempre que el archivo ya exista; `Write` sobrescribe todo el archivo y pierde contenido no relacionado si no tienes cuidado.
- Para varias ediciones no relacionadas en el mismo archivo, realiza varias llamadas `Edit` en secuencia en lugar de un reemplazo único grande y frágil.
- Evita introducir emojis, texto de marketing o bloques de documentación no solicitados al editar archivos de código fuente.
