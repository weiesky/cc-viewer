# Projects

Gestiona documentos de proyecto en la base de conocimiento de proyectos de Claude del usuario: leer, buscar, escribir y eliminar documentos, u obtener información del proyecto.

## Cuándo usar

- Persistir un documento (entregable, notas, material de referencia) en el proyecto del usuario para que sobreviva a la sesión.
- Leer o buscar documentos de proyecto existentes para fundamentar la tarea actual en contexto previo.
- Subir un archivo local al proyecto sin cargar su contenido en el contexto.
- Eliminar un documento de proyecto obsoleto.

## Parámetros

- `method` (string, obligatorio): Uno de `project_info`, `project_read`, `project_search`, `project_write`, `project_delete`.
- `path` (string, opcional): Para `project_read`/`project_write`/`project_delete`: la ruta del documento. Para `project_write`: una ruta existente se reemplaza en su lugar; un nombre de archivo nuevo sin barra (sin "/") recibe el namespace `claude/<name>`.
- `content` (string, opcional): Para `project_write`: texto del documento en línea. Mutuamente excluyente con `local_path`.
- `local_path` (string, opcional): Para `project_write`: un archivo dentro del directorio de trabajo para subir — su contenido nunca entra en tu contexto. Mutuamente excluyente con `content`.
- `present_to_user` (boolean, opcional): Para `project_write`: marca este documento como el entregable que el usuario necesita ver. Por defecto false; déjalo sin establecer para guardados rutinarios y escrituras en bloque.
- `query` (string, opcional): Para `project_search`: consulta a la base de conocimiento.
- `n` (number, opcional): Para `project_search`: número de resultados (por defecto 5).

## Ejemplos

### Ejemplo 1: Escribir el entregable en el proyecto

```
Projects(
  method="project_write",
  path="claude/migration-plan.md",
  local_path="./migration-plan.md",
  present_to_user=true
)
```

Sube el archivo local sin traer su contenido al contexto, y lo marca como el entregable del usuario.

### Ejemplo 2: Buscar en la base de conocimiento

```
Projects(method="project_search", query="authentication refresh tokens", n=5)
```

## Notas

- `content` es para texto que compones en línea; `local_path` es para cualquier cosa que ya esté en disco — nunca mezcles los dos.
- Usa `present_to_user=true` con moderación: solo para el único documento que el usuario pidió o sobre el que debe actuar.
