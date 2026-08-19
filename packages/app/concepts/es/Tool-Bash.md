# Bash

Ejecuta un comando de shell dentro de un directorio de trabajo persistente y devuelve su stdout/stderr. Conviene reservarlo para operaciones que ninguna herramienta dedicada de Claude Code pueda expresar, como ejecutar git, npm, docker o scripts de compilación.

## Cuándo usar

- Ejecutar operaciones de git (`git status`, `git diff`, `git commit`, `gh pr create`)
- Ejecutar gestores de paquetes y herramientas de compilación (`npm install`, `npm run build`, `pytest`, `cargo build`)
- Lanzar procesos de larga duración (servidores de desarrollo, watchers) en segundo plano con `run_in_background`
- Invocar CLIs específicos de dominio (`docker`, `terraform`, `kubectl`, `gh`) que no tienen equivalente integrado
- Encadenar pasos dependientes con `&&` cuando el orden importa

## Parámetros

- `command` (string, obligatorio): El comando de shell exacto a ejecutar.
- `description` (string, obligatorio): Un resumen corto en voz activa (de 5 a 10 palabras para comandos simples; más contexto para comandos con tuberías u oscuros).
- `timeout` (number, opcional): Tiempo de espera en milisegundos, hasta `600000` (10 minutos). Por defecto `120000` (2 minutos).
- `run_in_background` (boolean, opcional): Cuando es `true`, el comando se ejecuta desacoplado y recibes una notificación al completarse. No añadas `&` por tu cuenta.

## Ejemplos

### Ejemplo 1: Inspeccionar el estado del repositorio antes de hacer commit
Lanza `git status` y `git diff --stat` como dos llamadas `Bash` paralelas en el mismo mensaje para reunir contexto rápidamente, luego arma el commit en una llamada posterior.

### Ejemplo 2: Encadenar pasos de compilación dependientes
Usa una sola llamada como `npm ci && npm run build && npm test` para que cada paso solo se ejecute después de que el anterior tenga éxito. Usa `;` únicamente si intencionalmente quieres que pasos posteriores se ejecuten incluso tras fallos.

### Ejemplo 3: Servidor de desarrollo de larga duración
Invoca `npm run dev` con `run_in_background: true`. Recibirás una notificación cuando termine. No hagas polling con bucles de `sleep`; diagnostica los fallos en lugar de reintentar a ciegas.

## Notas

- El directorio de trabajo persiste entre llamadas, pero el estado del shell (variables exportadas, funciones de shell, aliases) no. Prefiere rutas absolutas y evita `cd` salvo que el usuario lo pida.
- Prefiere herramientas dedicadas sobre equivalentes con tuberías en el shell: `Glob` en vez de `find`/`ls`, `Grep` en vez de `grep`/`rg`, `Read` en vez de `cat`/`head`/`tail`, `Edit` en vez de `sed`/`awk`, `Write` en vez de `echo >` o heredocs, y texto normal del asistente en vez de `echo`/`printf` para salida hacia el usuario.
- Entrecomilla con dobles comillas cualquier ruta que contenga espacios (por ejemplo `"/Users/me/My Project/file.txt"`).
- Para comandos independientes, haz múltiples llamadas `Bash` en paralelo dentro de un solo mensaje. Encadena con `&&` solo cuando un comando depende de otro.
- La salida de más de 30000 caracteres se trunca. Cuando captures registros grandes, redirige a un archivo y luego léelo con la herramienta `Read`.
- Nunca uses flags interactivos como `git rebase -i` o `git add -i`; no pueden recibir entrada a través de esta herramienta.
- No omitas los hooks de git (`--no-verify`, `--no-gpg-sign`) ni realices operaciones destructivas (`reset --hard`, `push --force`, `clean -f`) a menos que el usuario lo solicite explícitamente.
