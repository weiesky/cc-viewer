# EnterWorktree

Crea un worktree de Git aislado sobre una nueva rama, o cambia la sesión a un worktree existente del repositorio actual, de modo que el trabajo paralelo o experimental pueda avanzar sin tocar el checkout principal.

## Cuándo usar

- El usuario dice explícitamente "worktree" — por ejemplo "inicia un worktree", "crea un worktree" o "trabaja en un worktree".
- Las instrucciones del proyecto en `CLAUDE.md` o la memoria persistente te indican usar un worktree para la tarea actual.
- Quieres continuar una tarea que previamente fue preparada como worktree (pasa `path` para volver a entrar).
- Varias ramas experimentales deben coexistir en disco sin cambios constantes de checkout.
- Una tarea de larga duración debe aislarse de ediciones no relacionadas en el árbol de trabajo principal.

## Parámetros

- `name` (string, opcional): Un nombre para el directorio del nuevo worktree. Cada segmento separado por `/` solo puede contener letras, dígitos, puntos, guiones bajos y guiones; la cadena completa está limitada a 64 caracteres. Si se omite y `path` también se omite, se genera un nombre aleatorio. Mutuamente excluyente con `path`.
- `path` (string, opcional): La ruta del sistema de archivos de un worktree existente del repositorio actual al que cambiar. Debe aparecer en `git worktree list` para este repo; las rutas que no sean worktrees registrados del repositorio actual son rechazadas. Mutuamente excluyente con `name`.

## Ejemplos

### Ejemplo 1: Crear un nuevo worktree con un nombre descriptivo

```
EnterWorktree(name="feat/okta-sso")
```

Crea `.claude/worktrees/feat/okta-sso` en una nueva rama basada en `HEAD`, y luego cambia el directorio de trabajo de la sesión a ese worktree. Todas las ediciones de archivos y comandos de shell posteriores operan dentro de ese worktree hasta que salgas.

### Ejemplo 2: Volver a entrar en un worktree existente

```
EnterWorktree(path="/Users/me/repo/.claude/worktrees/feat/okta-sso")
```

Reanuda el trabajo en un worktree creado previamente. Como entraste mediante `path`, `ExitWorktree` no lo eliminará automáticamente — salir con `action: "keep"` simplemente retorna al directorio original.

## Notas

- No llames a `EnterWorktree` salvo que el usuario lo haya pedido explícitamente o las instrucciones del proyecto lo requieran. Las solicitudes ordinarias de cambio de rama o corrección de bugs deben usar comandos normales de Git, no worktrees.
- Cuando se invoca dentro de un repositorio Git, la herramienta crea un worktree bajo `.claude/worktrees/` y registra una nueva rama basada en `HEAD`. Fuera de un repositorio Git, delega en los hooks `WorktreeCreate` / `WorktreeRemove` configurados en `settings.json` para aislamiento agnóstico del VCS.
- Solo una sesión de worktree está activa a la vez. La herramienta se niega a ejecutarse si ya estás dentro de una sesión de worktree; primero sal con `ExitWorktree`.
- Usa `ExitWorktree` para salir a mitad de sesión. Si la sesión termina estando aún dentro de un worktree recién creado, se le pregunta al usuario si desea conservarlo o eliminarlo.
- Los worktrees ingresados mediante `path` se consideran externos — `ExitWorktree` con `action: "remove"` no los eliminará. Esta es una barrera de seguridad para proteger worktrees que el usuario gestiona manualmente.
- Un worktree nuevo hereda el contenido de la rama actual pero tiene un directorio de trabajo e índice independientes. Los cambios con y sin staging del checkout principal no son visibles dentro del worktree.
- Consejo de nombrado: antepón el tipo de trabajo (`feat/`, `fix/`, `spike/`) para que varios worktrees concurrentes sean fáciles de distinguir en `git worktree list`.
