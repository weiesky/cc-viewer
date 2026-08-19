# ExitWorktree

Sale de una sesión de worktree creada previamente por `EnterWorktree` y devuelve la sesión al directorio de trabajo original. Esta herramienta solo actúa sobre los worktrees creados por `EnterWorktree` en la sesión actual; si no hay ninguna sesión activa de este tipo, la llamada no tiene efecto.

## Cuándo usar

- Has terminado el trabajo en un worktree aislado y deseas volver al directorio de trabajo principal.
- Completaste una tarea en un worktree de rama de función y, tras hacer el merge, quieres limpiar la rama y el directorio.
- Quieres conservar el worktree para usarlo más adelante y simplemente regresar al directorio original sin eliminar nada.
- Quieres abandonar una rama experimental o temporal sin dejar ningún artefacto en disco.
- Necesitas iniciar una nueva sesión de `EnterWorktree`, lo cual requiere salir primero de la actual.

## Parámetros

- `action` (cadena, obligatorio): `"keep"` conserva el directorio del worktree y la rama en disco para poder volver más adelante; `"remove"` elimina tanto el directorio como la rama, realizando una salida limpia.
- `discard_changes` (booleano, opcional, valor predeterminado `false`): Solo es relevante cuando `action` es `"remove"`. Si el worktree contiene archivos sin confirmar o commits que no están en la rama original, la herramienta rechaza la eliminación a menos que `discard_changes` sea `true`. La respuesta de error lista los cambios concretos para que puedas confirmar con el usuario antes de volver a invocar.

## Ejemplos

### Ejemplo 1: salida limpia tras hacer merge de los cambios

Después de finalizar el trabajo en un worktree y hacer merge de la rama en main, llama a `ExitWorktree` con `action: "remove"` para eliminar el directorio del worktree y la rama, y volver al directorio de trabajo original.

```
ExitWorktree(action: "remove")
```

### Ejemplo 2: descartar un worktree temporal con código experimental sin confirmar

Si un worktree contiene cambios experimentales sin confirmar que deben descartarse por completo, primero intenta `action: "remove"`. La herramienta rechazará la operación y listará los cambios sin confirmar. Tras confirmar con el usuario que los cambios pueden descartarse, vuelve a invocar con `discard_changes: true`.

```
ExitWorktree(action: "remove", discard_changes: true)
```

## Notas

- Esta herramienta solo actúa sobre worktrees creados por `EnterWorktree` en la sesión actual. No afectará a worktrees creados con `git worktree add`, worktrees de sesiones anteriores ni al directorio de trabajo normal si nunca se llamó a `EnterWorktree`; en esos casos la llamada no tiene efecto.
- `action: "remove"` se rechaza si el worktree tiene cambios sin confirmar o commits no presentes en la rama original, a menos que se proporcione explícitamente `discard_changes: true`. Confirma siempre con el usuario antes de establecer `discard_changes: true`, ya que los datos no pueden recuperarse.
- Si hay una sesión de tmux adjunta al worktree: con `remove` se termina; con `keep` continúa en ejecución y se devuelve su nombre para que el usuario pueda reconectarse más tarde.
- Tras completar `ExitWorktree`, se puede volver a llamar a `EnterWorktree` para iniciar una nueva sesión de worktree.
