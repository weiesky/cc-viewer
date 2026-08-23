# CC-Viewer

🌐 **Sitio web y recorrido por las funciones: [weiesky.github.io/cc-viewer](https://weiesky.github.io/cc-viewer/)** — disponible en 18 idiomas.


Un kit de herramientas de Vibe Coding destilado de la propia experiencia de desarrollo, construido sobre Claude Code:

1. Aumentar el límite de capacidad: ejecute /ultraPlan y /ultraReview localmente, para que el código de su proyecto nunca tenga que estar completamente expuesto a la nube de Claude;
2. Compatibilidad multiplataforma: permite la programación móvil (dentro de la LAN); la versión web se adapta a diversos escenarios, fácil de incrustar en extensiones del navegador y vistas divididas del sistema operativo, y proporciona un instalador nativo;
3. Registro completo: ofrece capacidades completas de interceptación y análisis del payload de Claude Code, ideal para registro, análisis de problemas, aprendizaje, inspiración e ingeniería inversa;
4. Aprendizaje y experiencia compartidos: se han acumulado numerosos materiales de estudio y experiencias de desarrollo (vea los iconos "?" en todo el sistema);
5. Experiencia nativa preservada: solo amplía las capacidades de Claude Code, sin modificaciones sustanciales al núcleo, manteniendo la experiencia nativa;
6. Soporta modelos de terceros: compatible con deepseek-v4-\*, GLM 5.1, Kimi K2.6, con la capacidad cc-switch incorporada para conmutar en caliente entre herramientas de terceros en cualquier momento. El diálogo de conmutación en caliente también admite fuentes por rol — Main Agent, Sub-Agents y Teammates pueden usar cada uno un perfil de proxy distinto (por defecto: seguir al Main Agent); cuando el Main Agent usa el Default integrado con el endpoint oficial, la asignación de roles permanece oculta e inactiva.

<img width="860" alt="cc-viewer — deploy once, share with every device" src="https://raw.githubusercontent.com/weiesky/cc-viewer/main/docs/cc-viewer-share.svg" />

[English](../README.md) | [简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | Español | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Uso

### Requisitos previos

* Asegúrese de tener Node.js 20.0.0+ instalado; [Descargar e instalar](https://nodejs.org)
* Asegúrese de tener Claude Code instalado; [Tutorial de instalación](https://github.com/anthropics/claude-code)

### Instalar ccv

#### Instalación con npm

```bash
npm install -g cc-viewer --registry=https://registry.npmjs.org
```

#### Instalación con Homebrew (recomendado para macOS / Linux)

```bash
brew tap weiesky/cc-viewer
brew install cc-viewer
brew upgrade cc-viewer   # para actualizaciones — no use npm install -g con instalaciones brew
```

#### Instalación con pnpm (global)

```bash
pnpm add -g cc-viewer
pnpm add -g cc-viewer@latest   # para actualizaciones — no use npm install -g con instalaciones pnpm
```

### Lanzamiento

ccv es un reemplazo directo para claude — todos los argumentos se pasan a claude al mismo tiempo que se lanza el Web Viewer.

```bash
ccv                    # == claude (modo interactivo)
```

El comando que el propio autor usa con más frecuencia es:

```
ccv -c --d             # == claude --continue --dangerously-skip-permissions
                       # ccv pasa todos los parámetros de inicio de Claude Code — puede combinarlos como desee
```

Después de iniciar en modo programación, se abrirá automáticamente una página web.

cc-viewer también se distribuye como aplicación de escritorio nativa: [Página de descarga](https://github.com/weiesky/cc-viewer/releases)

### Modo SDK (headless, `ccv -SDK`)

`ccv -SDK` ejecuta la sesión a través del Agent SDK en lugar de un terminal interactivo — sin panel de terminal; los mensajes se envían desde la interfaz web, y todo lo demás (registros de sesión, efecto máquina de escribir en streaming, estadísticas de uso) funciona igual que en el modo terminal.

```bash
ccv -SDK                # sesión headless; chatea desde el navegador
ccv -SDK -c             # continúa la sesión más reciente
ccv -SDK --model sonnet # elige un modelo
```

Las aprobaciones (Bash/Edit/Write/WebFetch/…) aparecen en el navegador con permitir / denegar / permitir durante la sesión, y los mensajes de `AskUserQuestion` / plan se muestran como modales. `npm publish` siempre requiere una aprobación explícita — incluso con `--d`. Requiere el paquete `@anthropic-ai/claude-agent-sdk` (incluido con cc-viewer); si no está disponible, se recurre al modo terminal.

### Actualización a 1.7.0 (formato de log v2)

Desde la versión 1.7.0, los logs se almacenan en un formato de directorio por sesión (wire-format v2) en lugar de archivos `.jsonl` individuales, ocupando aproximadamente un 90 % menos de espacio en disco. Los archivos `.jsonl` v1 existentes nunca se modifican ni se eliminan; el cuadro de diálogo de logs muestra las sesiones v2 de forma predeterminada, y una pequeña entrada «Ver logs heredados (v1)» (visible mientras existan archivos antiguos) abre una vista v1 donde se pueden ver, migrar o eliminar. Al iniciarse, cc-viewer ofrece una migración con un solo clic cuando se detectan logs heredados (muy recomendable al continuar una conversación antigua con `claude -c`, cuya primera mitad reside en los archivos antiguos). También puedes migrar desde la terminal:

```bash
ccv convert <project>   # migrar un proyecto
ccv convert --all       # migrar todos los proyectos
ccv verify <v1-file>    # comprobar un archivo v1 con sus sesiones convertidas
```

Si una sesión no supera la verificación golden, se retiene en `sessions-quarantine/` para su inspección en lugar de hacer fracasar toda la migración; las demás sesiones se migran igualmente.

### Modo Logger

Si aún prefiere la herramienta nativa claude o la extensión de VS Code, use este modo.

En este modo, al iniciar `claude`

se iniciará automáticamente un proceso de registro que guarda los registros de solicitudes en directorios por sesión dentro de \~/.claude/cc-viewer/*yourproject*/sessions/ (wire-format v2)

Habilitar el modo logger:

```bash
ccv -logger
```

Cuando la consola no puede imprimir el puerto específico, el primer puerto predeterminado es 127.0.0.1:7008. Las instancias múltiples usan puertos secuenciales como 7009, 7010.

Desinstalar el modo logger:

```bash
ccv --uninstall
```

### Solución de problemas (Troubleshooting)

Si encuentra problemas al iniciar cc-viewer, aquí está el enfoque definitivo para la solución de problemas:
Paso 1: Abra Claude Code en cualquier directorio.
Paso 2: Dé a Claude Code la siguiente instrucción:

```
He instalado el paquete npm cc-viewer, pero al ejecutar ccv aún no funciona correctamente. Revise cli.js y findcc.js de cc-viewer y adáptelos al despliegue local de Claude Code según el entorno específico. Mantenga el alcance de los cambios lo más restringido posible dentro de findcc.js.
```

¡Dejar que Claude Code diagnostique el problema por sí mismo es más efectivo que preguntar a nadie o leer cualquier documentación!

Una vez completada la instrucción anterior, se actualizará findcc.js. Si su proyecto requiere frecuentemente despliegue local, o si el código forkeado a menudo necesita resolver problemas de instalación, mantener este archivo le permite simplemente copiarlo la próxima vez. En este momento, muchos proyectos y empresas que usan Claude Code no están desplegando en Mac sino en entornos alojados del lado del servidor, por lo que el autor ha separado el archivo findcc.js para facilitar el seguimiento de las actualizaciones del código fuente de cc-viewer en el futuro.

Nota: Esta aplicación entra en conflicto con claude-code-switch y claude-code-router debido a la competencia de proxy, por lo que al usarla asegúrese de cerrar claude-code-switch y claude-code-router. cc-viewer incluye una capacidad de actualización en caliente de proxy como reemplazo equivalente.

### Otros comandos auxiliares

Consulte:

```bash
ccv -h
```

### Modo silencioso (Silent Mode)

Por defecto, `ccv` se ejecuta en modo silencioso cuando envuelve `claude`, manteniendo la salida del terminal limpia y consistente con la experiencia nativa. Todos los registros se capturan en segundo plano y se pueden ver en `http://localhost:7008`.

Una vez configurado, use el comando `claude` normalmente. Visite `http://localhost:7008` para acceder a la interfaz de monitoreo.

## Características

### Modo Programación

Después de iniciar con ccv, puede ver:

<img height="765" width="1500" alt="image" src="https://github.com/user-attachments/assets/ab353a2b-f101-409d-a28c-6a4e41571ea2" />

Puede ver las diferencias de código directamente después de editar:

<img height="728" width="1500" alt="image" src="https://github.com/user-attachments/assets/2a4acdaa-fc5f-4dc0-9e5f-f3273f0849b2" />

Aunque puede abrir archivos y codificar manualmente, no se recomienda la codificación manual — ¡eso es programación anticuada!

### Programación móvil

Incluso puede escanear un código QR para programar desde su dispositivo móvil:

<img height="1460" width="3018" alt="image" src="https://github.com/user-attachments/assets/8debf48e-daec-420c-b37a-609f8b81cd20" />

<img height="790" width="1700" alt="image" src="https://github.com/user-attachments/assets/da3e519f-ff66-4cd2-81d1-f4e131215f6c" />

Cumpla su imaginación sobre la programación móvil. También hay un mecanismo de plugins — si necesita personalizar para sus hábitos de codificación, esté atento a las actualizaciones de los hooks de plugins.

### Prompts del sistema por modelo

El modal **Editar prompt del sistema** (menú de hamburguesa → Editar prompt del sistema) está organizado en pestañas:

* La pestaña **Predeterminado** conserva el comportamiento clásico: escribe `CC_SYSTEM.md` (sustituir) o `CC_APPEND_SYSTEM.md` (añadir) en el espacio de trabajo actual, inyectado como `--system-prompt-file` / `--append-system-prompt-file` en el siguiente arranque de ccv.
* **Pestañas de modelo**: haga clic en **+ Añadir modelo**, escriba un nombre como `opus` o `Gemini3` y elija un ámbito — **Global** (`~/.claude/cc-viewer/system_prompt/`, se aplica a todos los espacios de trabajo) o **Espacio de trabajo** (`<project>/system_prompt/`). El campo de nombre ofrece sugerencias mientras escribe basadas en sus modelos configurados localmente (perfiles de proxy con recarga en caliente y `settings.json`); los nombres ya añadidos en el ámbito elegido se ocultan, y los nombres arbitrarios de forma libre siguen estando permitidos. Cada pestaña tiene su propio interruptor Añadir/Sustituir y su vista previa de Markdown.
* Las entradas se almacenan como archivos en mayúsculas: `OPUS_SYSTEM.md` (sustituir) u `OPUS_APPEND_SYSTEM.md` (añadir). La coincidencia es difusa — una subcadena, sin distinción de mayúsculas y minúsculas, del ID de modelo resuelto a partir de la configuración ACTIVA (mapeo de modelo del proxy profile de terceros activo > variables de entorno `ANTHROPIC_MODEL`/`CLAUDE_MODEL` al arrancar > `model` de `settings.json`; sin señal de configuración no se inyecta ninguna entrada), de modo que `opus` coincide con `claude-opus-4-8[1m]` sin importar la versión. Una coincidencia de espacio de trabajo prevalece sobre una global; dentro de un ámbito gana el nombre más largo; una entrada coincidente reemplaza por completo los archivos de Predeterminado para ese arranque. Limitaciones conocidas: cambiar de proxy profile a mitad de sesión solo se vuelve a evaluar tras reiniciar la sesión de claude; un `--model` pasado por argumentos adicionales no se consulta.
* Guardar una pestaña vacía elimina la entrada. Los cambios de modelo realizados a mitad de sesión se aplican en el siguiente relanzamiento. Establezca `CCV_DISABLE_AUTO_SYSTEM_PROMPT=1` para desactivar toda inyección automática. Puede hacer commit de `<project>/system_prompt/` para compartir prompts con su equipo, o añadirlo a `.gitignore` para mantenerlos privados.

### Modo Logger (Ver sesiones completas de Claude Code)

<img width="860" alt="cc-viewer — wire-level capture and packet decomposition" src="https://raw.githubusercontent.com/weiesky/cc-viewer/main/docs/cc-viewer-proxy.svg" />

* Captura todas las solicitudes API de Claude Code en tiempo real, asegurando texto sin procesar — no registros censurados (¡¡¡esto es importante!!!)
* Identifica y etiqueta automáticamente las solicitudes de Main Agent y Sub Agent (subtipos: Plan, Search, Bash)
* Las solicitudes de MainAgent admiten Body Diff JSON, mostrando diferencias plegadas respecto a la solicitud anterior de MainAgent (solo campos modificados/nuevos)
* Cada solicitud muestra estadísticas de uso de Token en línea (Tokens de entrada/salida, creación/lectura de caché, tasa de aciertos)
* Compatible con Claude Code Router (CCR) y otros escenarios de proxy — recurre al patrón de ruta API

<a href="https://www.star-history.com/?repos=weiesky%2Fcc-viewer&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=weiesky/cc-viewer&type=date&theme=dark&legend=top-left" />

    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=weiesky/cc-viewer&type=date&legend=top-left" />

    ![Star History Chart](https://api.star-history.com/chart?repos=weiesky/cc-viewer&type=date&legend=top-left)
  </picture>
</a>

## License

MIT
