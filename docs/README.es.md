# CC-Viewer

Sistema de monitoreo de solicitudes para Claude Code que captura y visualiza en tiempo real todas las solicitudes y respuestas de API (texto original, sin recortes). Permite a los desarrolladores monitorear su Context para revisar y solucionar problemas durante el Vibe Coding.
La ultima version de CC-Viewer tambien ofrece soluciones de programacion web con despliegue en servidor, asi como herramientas de programacion para dispositivos moviles. Te invitamos a utilizarlo en tus propios proyectos; en el futuro se abriran mas funciones de plugins y se admitira el despliegue en la nube.

Primero veamos la parte interesante -- asi se ve en dispositivos moviles:

<img width="1700" height="790" alt="image" src="https://github.com/user-attachments/assets/da3e519f-ff66-4cd2-81d1-f4e131215f6c" />

[English](../README.md) | [简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | Español | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Uso

### Instalacion

```bash
npm install -g cc-viewer --registry=https://registry.npmjs.org
```

### Modo programacion

ccv es un reemplazo directo de claude -- todos los parametros se pasan directamente a claude, mientras se inicia el Web Viewer.

```bash
ccv                    # == claude (modo interactivo)
ccv -c                 # == claude --continue (continuar ultima conversacion)
ccv -r                 # == claude --resume (reanudar conversacion)
ccv -p "hello"         # == claude --print "hello" (modo impresion)
ccv --d                # == claude --dangerously-skip-permissions (atajo)
ccv --model opus       # == claude --model opus
```

El comando que el autor usa habitualmente es:
```
ccv -c --d             # == claude --continue --dangerously-skip-permissions
```

Una vez iniciado el modo programacion, se abrira automaticamente la pagina web.

Puedes usar Claude directamente desde la pagina web, y al mismo tiempo consultar los mensajes completos de las solicitudes y ver los cambios en el codigo.

Y lo que es aun mas atractivo: puedes incluso programar desde un dispositivo movil!


### Modo logger

⚠️ Si todavia prefieres usar la herramienta nativa de claude o el plugin de VS Code, usa este modo.

En este modo, al iniciar ```claude``` o ```claude --dangerously-skip-permissions```

se iniciara automaticamente un proceso de registro que guarda los logs de solicitudes en ~/.claude/cc-viewer/*tuproyecto*/date.jsonl

Iniciar modo logger:
```bash
ccv -logger
```

Cuando no se puede imprimir el puerto especifico en la consola, el primer puerto de inicio predeterminado es 127.0.0.1:7008. Si existen multiples instancias, se incrementan al final, como 7009, 7010.

Este comando detecta automaticamente el metodo de instalacion local de Claude Code (NPM o Native Install) y se adapta en consecuencia.

- **Claude Code version NPM**: Inyecta automaticamente el script interceptor en `cli.js` de Claude Code.
- **Claude Code version Native**: Detecta automaticamente el binario `claude`, configura un proxy transparente local y establece un Zsh Shell Hook para redirigir el trafico automaticamente.
- Se recomienda usar Claude Code instalado mediante NPM para este proyecto.

Desinstalar modo logger:
```bash
ccv --uninstall
```

### Solucion de problemas (Troubleshooting)

Si tienes problemas para iniciar, existe una solucion de diagnostico definitiva:
Paso 1: abre Claude Code en cualquier directorio;
Paso 2: dale a Claude Code la siguiente instruccion:
```
He instalado el paquete npm cc-viewer, pero despues de ejecutar ccv sigue sin funcionar correctamente. Revisa cli.js y findcc.js de cc-viewer, y adapta la implementacion local de Claude Code segun el entorno especifico. Intenta limitar el alcance de los cambios a findcc.js.
```
Dejar que Claude Code inspeccione los errores por si mismo es mas efectivo que preguntarle a cualquier persona o leer cualquier documentacion!

Una vez completada la instruccion anterior, se actualizara findcc.js. Si tu proyecto frecuentemente requiere despliegue local, o si el codigo bifurcado necesita resolver problemas de instalacion con frecuencia, conserva este archivo para copiarlo directamente la proxima vez. En la actualidad, muchos proyectos y empresas que usan Claude Code no lo despliegan en Mac sino en servidores, por lo que el autor separo el archivo findcc.js para facilitar el seguimiento de las actualizaciones del codigo fuente de cc-viewer.

### Otros comandos auxiliares

Consultar:
```bash
ccv -h
```

### Anulacion de configuracion (Configuration Override)

Si necesitas utilizar un endpoint de API personalizado (por ejemplo, un proxy corporativo), simplemente configuralo en `~/.claude/settings.json` o establece la variable de entorno `ANTHROPIC_BASE_URL`. `ccv` reconocera automaticamente esta configuracion y reenviara las solicitudes correctamente.

### Modo silencioso (Silent Mode)

De forma predeterminada, `ccv` se ejecuta en modo silencioso al envolver `claude`, lo que garantiza que la salida de tu terminal permanezca limpia e identica a la experiencia nativa. Todos los registros se capturan en segundo plano y son visibles en `http://localhost:7008`.

Una vez completada la configuracion, usa el comando `claude` como de costumbre. Abre `http://localhost:7008` para ver la interfaz de monitoreo.


## Funciones


### Modo programacion

Despues de iniciar con ccv puedes ver:

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/ab353a2b-f101-409d-a28c-6a4e41571ea2" />


Puedes ver directamente el diff del codigo despues de completar la edicion:

<img width="1500" height="728" alt="image" src="https://github.com/user-attachments/assets/2a4acdaa-fc5f-4dc0-9e5f-f3273f0849b2" />

Aunque puedes abrir archivos y programar manualmente, no se recomienda -- eso es programacion antigua!

### Programacion en dispositivos moviles

Incluso puedes escanear un codigo QR para programar en dispositivos moviles:

<img width="3018" height="1460" alt="image" src="https://github.com/user-attachments/assets/8debf48e-daec-420c-b37a-609f8b81cd20" />

Satisface tu imaginacion sobre la programacion movil. Ademas, hay un mecanismo de plugins -- si necesitas personalizar segun tus habitos de programacion, puedes seguir las actualizaciones de los hooks de plugins en el futuro.

### Modo logger (ver conversacion completa de Claude Code)

<img width="1500" height="768" alt="image" src="https://github.com/user-attachments/assets/a8a9f3f7-d876-4f6b-a64d-f323a05c4d21" />


- Captura en tiempo real todas las solicitudes de API enviadas por Claude Code, asegurando que sea el texto original, no logs recortados (esto es muy importante!!!)
- Identifica y marca automaticamente las solicitudes de Main Agent y Sub Agent (subtipos: Plan, Search, Bash)
- Las solicitudes de MainAgent admiten Body Diff JSON, mostrando de forma colapsada las diferencias con la solicitud anterior de MainAgent (solo muestra campos modificados/nuevos)
- Cada solicitud muestra estadisticas de uso de Token en linea (Token de entrada/salida, creacion/lectura de cache, tasa de aciertos)
- Compatible con Claude Code Router (CCR) y otros escenarios de proxy -- coincidencia de solicitudes mediante patron de ruta API como respaldo

### Modo conversacion

Haz clic en el boton "Modo conversacion" en la esquina superior derecha para visualizar el historial completo de conversacion del Main Agent como una interfaz de chat:

<img width="1500" height="764" alt="image" src="https://github.com/user-attachments/assets/725b57c8-6128-4225-b157-7dba2738b1c6" />


- Actualmente no admite la visualizacion de Agent Team
- Mensajes del usuario alineados a la derecha (burbuja azul), respuestas del Main Agent alineadas a la izquierda (burbuja oscura)
- Los bloques `thinking` estan colapsados por defecto, se renderizan en Markdown, haz clic para expandir y ver el proceso de pensamiento; admite traduccion con un clic (funcion aun inestable)
- Los mensajes de seleccion del usuario (AskUserQuestion) se muestran en formato de pregunta y respuesta
- Sincronizacion bidireccional de modos: al cambiar al modo conversacion se posiciona automaticamente en la conversacion correspondiente a la solicitud seleccionada; al volver al modo original se posiciona automaticamente en la solicitud seleccionada
- Panel de configuracion: permite cambiar el estado de colapso predeterminado de los resultados de herramientas y bloques de pensamiento
- Navegacion de conversacion en movil: en modo CLI movil, haz clic en el boton "Navegacion de conversacion" en la barra superior para deslizar una vista de conversacion de solo lectura y navegar por el historial completo de conversacion en el movil

### Herramientas de estadisticas

Panel flotante "Estadisticas de datos" en el area del encabezado:

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/a3d2db47-eac3-463a-9b44-3fa64994bf3b" />

- Muestra la cantidad de cache creation/read y la tasa de aciertos de cache
- Estadisticas de reconstruccion de cache: agrupadas por razon (TTL, cambio de system/tools/model, truncamiento/modificacion de mensajes, cambio de key) mostrando cantidad y tokens de cache_creation
- Estadisticas de uso de herramientas: frecuencia de llamadas por herramienta, ordenadas por cantidad de llamadas
- Estadisticas de uso de Skills: frecuencia de llamadas por Skill, ordenadas por cantidad de llamadas
- Soporte para estadisticas de teammates
- Iconos de ayuda conceptual (?): haz clic para ver la documentacion integrada de MainAgent, CacheRebuild y cada herramienta

### Gestion de logs

A traves del menu desplegable de CC-Viewer en la esquina superior izquierda:
<img width="1500" height="760" alt="image" src="https://github.com/user-attachments/assets/33295e2b-f2e0-4968-a6f1-6f3d1404454e" />

**Compresion de logs**
Sobre el tema de los logs, el autor quiere aclarar que no se ha modificado ninguna definicion oficial de Anthropic, para garantizar la integridad de los logs.
Sin embargo, dado que los logs individuales de 1M Opus pueden volverse extremadamente grandes en etapas posteriores, gracias a algunas optimizaciones del autor en los logs de MainAgent, se puede reducir el tamano en al menos un 66% sin gzip.
El metodo para analizar estos logs comprimidos se puede extraer del repositorio actual.

### Mas funciones utiles y practicas

<img width="1500" height="767" alt="image" src="https://github.com/user-attachments/assets/add558c5-9c4d-468a-ac6f-d8d64759fdbd" />

Puedes localizar rapidamente tu prompt a traves de las herramientas de la barra lateral

---

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/82b8eb67-82f5-41b1-89d6-341c95a047ed" />

El interesante KV-Cache-Text te ayuda a ver lo que Claude realmente esta viendo

---

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/54cdfa4e-677c-4aed-a5bb-5fd946600c46" />

Puedes subir imagenes y describir tus necesidades -- Claude tiene una excelente capacidad de comprension de imagenes. Y como sabes, puedes pegar capturas de pantalla directamente con Ctrl+V; en el dialogo se muestra tu contenido completo

---

<img width="600" height="370" alt="image" src="https://github.com/user-attachments/assets/87d332ea-3e34-4957-b442-f9d070211fbf" />

Puedes crear plugins personalizados, gestionar todos los procesos de CC-Viewer y CC-Viewer ofrece cambio en caliente de interfaces de terceros (si, puedes usar GLM, Kimi, MiniMax, Qwen, DeepSeek -- aunque el autor opina que actualmente son bastante debiles)

---


<img width="1500" height="746" alt="image" src="https://github.com/user-attachments/assets/b1f60c7c-1438-4ecc-8c64-193d21ee3445" />

Mas funciones esperan ser descubiertas... por ejemplo: el sistema soporta Agent Team e incluye un Code Reviewer integrado. La integracion del Code Reviewer de Codex esta por llegar (el autor recomienda mucho usar Codex para hacer Code Review de Claude Code)


### Actualizacion automatica

CC-Viewer comprueba automaticamente si hay actualizaciones al iniciar (como maximo una vez cada 4 horas). Dentro de la misma version mayor (por ejemplo, 1.x.x -> 1.y.z) se actualiza automaticamente y surte efecto en el siguiente inicio. Para cambios de version mayor solo se muestra una notificacion.

La actualizacion automatica sigue la configuracion global de Claude Code en `~/.claude/settings.json`. Si Claude Code tiene desactivadas las actualizaciones automaticas (`autoUpdates: false`), CC-Viewer tambien omitira la actualizacion automatica.

### Soporte multilingue

CC-Viewer admite 18 idiomas y cambia automaticamente segun el idioma del sistema:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
